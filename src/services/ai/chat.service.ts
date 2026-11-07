import { AiConversation, AiTurn } from '../../models/ai/ai.model.js';
import type { AiOwner, AiEvent } from '../../types/ai/ai.types.js';
import { beginTurn } from './conversation.service.js';
import { retrieveKnowledge, productCardsByIds } from './retrieval.service.js';
import { aiProvider } from './providers/openai.provider.js';
import { reserveUsage } from './usage.service.js';
import { registerTurn } from './active-turns.js';
export async function runChat(
  owner: AiOwner,
  input: { conversationId: string; requestId: string; content: string },
  signal: AbortSignal,
  emit: (event: AiEvent) => void
) {
  await reserveUsage(`chat:${owner.kind}:${owner.id}`, 20, 60000);
  const { turn, replay } = await beginTurn(
    input.conversationId,
    owner,
    input.requestId,
    input.content
  );
  const send = (type: string, data?: unknown) =>
    emit({ type, requestId: input.requestId, data });
  if (replay) {
    send('chat:completed', {
      answer: turn.answer,
      status: turn.status,
      sources: turn.sources,
      products: await productCardsByIds(
        (turn.productIds ?? []).map(String),
        signal
      ),
    });
    return;
  }
  const controller = new AbortController();
  const release = registerTurn(input.conversationId, controller);
  signal = AbortSignal.any([signal, controller.signal]);
  const monitor = setInterval(() => {
    void AiConversation.exists({
      _id: input.conversationId,
      status: 'active',
      activeRequestId: input.requestId,
    })
      .then((active) => {
        if (!active) controller.abort();
      })
      .catch(() => controller.abort());
  }, 1000);
  monitor.unref();
  send('chat:accepted');
  let answer = '';
  let status: 'completed' | 'cancelled' | 'failed' = 'failed';
  try {
    send('chat:status', 'Đang tìm thông tin cửa hàng…');
    const old = await AiTurn.find({
      conversationId: input.conversationId,
      status: 'completed',
      _id: { $ne: turn._id },
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    const history = old.reverse().flatMap((t) => [
      { role: 'user' as const, content: t.content },
      { role: 'assistant' as const, content: t.answer },
    ]);
    const query =
      input.content.length < 80 && old.length
        ? `${old.at(-1)!.content.slice(0, 150)}; ${input.content}`
        : input.content;
    const knowledge = await retrieveKnowledge(query, signal);
    signal.throwIfAborted();
    send('chat:status', 'Đang soạn trả lời…');
    for await (const delta of aiProvider.answerStream(
      input.content,
      JSON.stringify(knowledge),
      history,
      signal
    )) {
      signal.throwIfAborted();
      if (answer.length + delta.length > 16000) throw new Error('Output limit');
      answer += delta;
      send('chat:delta', delta);
    }
    if (!answer.trim()) throw new Error('Empty AI response');
    const active = await AiConversation.exists({
      _id: input.conversationId,
      status: 'active',
      activeRequestId: input.requestId,
    });
    if (!active) throw new Error('Conversation ended');
    const saved = await AiTurn.updateOne(
      { _id: turn._id, status: 'processing' },
      {
        $set: {
          answer,
          status: 'completed',
          productIds: knowledge.products.map((p) => p.id),
          sources: knowledge.sources.map(({ key, title, href }) => ({
            key,
            title,
            href,
          })),
        },
      }
    );
    if (!saved.modifiedCount) throw new Error('Turn no longer active');
    status = 'completed';
    send('chat:completed', {
      answer,
      status,
      sources: knowledge.sources.map(({ key, title, href }) => ({
        key,
        title,
        href,
      })),
      products: knowledge.products,
    });
  } catch {
    status = signal.aborted ? 'cancelled' : 'failed';
    await AiTurn.updateOne(
      { _id: turn._id, status: 'processing' },
      { $set: { answer, status } }
    );
    send('chat:error', {
      message:
        status === 'cancelled'
          ? 'Đã dừng trả lời.'
          : 'Chưa thể trả lời. Bạn có thể tìm sản phẩm trên cửa hàng hoặc thử lại.',
      status,
    });
  } finally {
    clearInterval(monitor);
    release();
    await AiConversation.updateOne(
      { _id: input.conversationId, activeRequestId: input.requestId },
      { $set: { busyUntil: null, activeRequestId: null } }
    );
  }
}
