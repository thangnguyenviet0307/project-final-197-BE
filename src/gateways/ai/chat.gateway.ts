import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { AiSocketTicket } from '../../models/ai/ai.model.js';
import {
  digest,
  checkCustomerToken,
} from '../../services/ai/identity.service.js';
import { frontendOrigins } from '../../config/frontend-origins.js';
import { chatEventSchema } from '../../validations/ai/ai.validation.js';
import { runChat } from '../../services/ai/chat.service.js';
import { cancelTurn } from '../../services/ai/conversation.service.js';
import type { AiOwner, AiEvent } from '../../types/ai/ai.types.js';

export function attachAiGateway(server: HttpServer) {
  const io = new Server(server, {
    path: '/api/v1/ai/socket',
    maxHttpBufferSize: 12000,
    perMessageDeflate: false,
    transports: ['websocket'],
    cors: { origin: frontendOrigins(), credentials: true },
    allowRequest: (req, callback) =>
      callback(
        null,
        !!req.headers.origin && frontendOrigins().includes(req.headers.origin)
      ),
  });
  io.use((socket, next) => {
    void (async () => {
      const raw: unknown = socket.handshake.auth['ticket'];
      if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw))
        throw new Error('Invalid ticket');
      const ticket = await AiSocketTicket.findOneAndDelete({
        _id: digest(raw),
        expiresAt: { $gt: new Date() },
      });
      if (!ticket) throw new Error('Expired ticket');
      const owner: AiOwner = {
        kind: ticket.ownerKind as AiOwner['kind'],
        id: ticket.ownerId,
      };
      const token: unknown = socket.handshake.auth['accessToken'];
      if (owner.kind === 'customer') {
        if (
          typeof token !== 'string' ||
          (await checkCustomerToken(token)) !== owner.id
        )
          throw new Error('Session expired');
      } else if (token) throw new Error('Owner mismatch');
      socket.data['owner'] = owner;
      socket.data['accessToken'] = token;
      next();
    })().catch(() =>
      next(new Error('Phiên kết nối không hợp lệ hoặc đã hết hạn.'))
    );
  });
  io.on('connection', (socket) => {
    const owner = socket.data['owner'] as AiOwner;
    let running: { requestId: string; conversationId: string; content: string; controller: AbortController } | undefined;
    let messages = 0;
    let windowStart = Date.now();
    let pendingBytes = 0;
    socket.conn.on('drain', () => {
      pendingBytes = 0;
    });
    const emit = (event: AiEvent) => {
      if (!socket.connected) return;
      pendingBytes += Buffer.byteLength(JSON.stringify(event));
      if (pendingBytes > 256000) {
        socket.disconnect(true);
        return;
      }
      socket.emit(event.type, event);
    };
    const life = setTimeout(() => socket.disconnect(true), 15 * 60000);
    life.unref();
    socket.on('disconnect', () => {
      clearTimeout(life);
      running?.controller.abort();
    });
    const handle = async (
      name: 'chat:send' | 'chat:cancel',
      payload: unknown
    ) => {
      if (Date.now() - windowStart >= 60000) {
        messages = 0;
        windowStart = Date.now();
      }
      if (++messages > 40) {
        socket.disconnect(true);
        return;
      }
      if (
        owner.kind === 'customer' &&
        (await checkCustomerToken(socket.data['accessToken'] as string)) !==
          owner.id
      )
        throw new Error('Session expired');
      if (!socket.connected) return;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Invalid payload');
      const input = chatEventSchema.parse({ ...payload, type: name });
      if (input.type === 'chat:cancel') {
        if (running?.requestId === input.requestId) {
          const result = await cancelTurn(running.conversationId, owner, input.requestId, running.content);
          emit({ type: 'chat:cancel-result', requestId: input.requestId, data: result });
        }
        return;
      }
      if (running) throw new Error('Already processing');
      const controller = new AbortController();
      running = { requestId: input.requestId, conversationId: input.conversationId, content: input.content, controller };
      const timeout = setTimeout(() => controller.abort(), 75000);
      timeout.unref();
      try {
        await runChat(owner, input, controller.signal, emit);
      } finally {
        clearTimeout(timeout);
        running = undefined;
      }
    };
    for (const name of ['chat:send', 'chat:cancel'] as const)
      socket.on(name, (payload: unknown) => {
        void handle(name, payload).catch(() =>
          emit({
            type: 'chat:error',
            data: {
              message:
                'Yêu cầu không hợp lệ, phiên hết hạn hoặc hội thoại đang bận.',
            },
          })
        );
      });
    emit({ type: 'chat:ready' });
  });
  return () => {
    io.disconnectSockets(true);
    io.engine.close();
  };
}
