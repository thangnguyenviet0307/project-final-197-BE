import mongoose from 'mongoose';
import createError from 'http-errors';
import { randomBytes } from 'node:crypto';
import {
  AiConversation,
  AiSocketTicket,
  AiTurn,
} from '../../models/ai/ai.model.js';
import type { AiOwner } from '../../types/ai/ai.types.js';
import { DAY, HOUR, guestExpiry, messageExpiry } from './config.js';
import { digest } from './identity.service.js';
import { cancelConversation, cancelRegisteredTurn } from './active-turns.js';
import { productCardsByIds } from './retrieval.service.js';
const ownerFilter = (owner: AiOwner) => ({
  ownerKind: owner.kind,
  ownerId: owner.id,
});
export async function createConversation(owner: AiOwner, now = new Date()) {
  return AiConversation.create({
    ...ownerFilter(owner),
    lastActivityAt: now,
    expiresAt: messageExpiry(owner.kind, now),
  });
}
export async function ownedConversation(
  id: string,
  owner: AiOwner,
  now = new Date()
) {
  const doc = await AiConversation.findOne({
    _id: id,
    ...ownerFilter(owner),
    expiresAt: { $gt: now },
  });
  if (!doc) throw createError(404, 'Không tìm thấy hội thoại.');
  if (
    doc.status === 'active' &&
    doc.lastActivityAt.getTime() + HOUR <= now.getTime()
  ) {
    await endConversation(
      id,
      owner,
      new Date(doc.lastActivityAt.getTime() + HOUR),
      doc.lastActivityAt
    );
    // Re-read after the conditional end: another process may have just renewed activity.
    const fresh = await AiConversation.findOne({
      _id: id,
      ...ownerFilter(owner),
      expiresAt: { $gt: now },
    });
    if (!fresh) throw createError(404, 'Không tìm thấy hội thoại.');
    return fresh;
  }
  return doc;
}
export async function listConversations(owner: AiOwner, page = 1) {
  const query = { ...ownerFilter(owner), expiresAt: { $gt: new Date() } };
  const [rows, total] = await Promise.all([
    AiConversation.find(query)
      .select('-ownerId -activeRequestId -busyUntil')
      .sort({ lastActivityAt: -1 })
      .skip((page - 1) * 10)
      .limit(10)
      .lean(),
    AiConversation.countDocuments(query),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      status:
        row.status === 'active' &&
        row.lastActivityAt.getTime() + HOUR <= Date.now()
          ? 'completed'
          : row.status,
    })),
    total,
    page,
  };
}
export async function history(id: string, owner: AiOwner, page = 1) {
  const conversation = await ownedConversation(id, owner);
  const rows = await AiTurn.find({
    conversationId: id,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * 20)
    .limit(20)
    .lean();
  const cards = await productCardsByIds([
    ...new Set(rows.flatMap((t) => (t.productIds ?? []).map(String))),
  ]);
  const byId = new Map(cards.map((p) => [p.id, p]));
  return {
    conversation: {
      id: String(conversation._id),
      status: conversation.status,
      endedAt: conversation.endedAt,
      lastActivityAt: conversation.lastActivityAt,
      expiresAt: conversation.expiresAt,
    },
    rows: rows.reverse().map((t) => ({
      ...t,
      products: (t.productIds ?? [])
        .map((id) => byId.get(String(id)))
        .filter((p): p is NonNullable<typeof p> => !!p),
    })),
    page,
  };
}
export async function endConversation(
  id: string,
  owner: AiOwner,
  endedAt = new Date(),
  expectedActivity?: Date
) {
  const result = await mongoose.connection.transaction(async (session) => {
    const current = await AiConversation.findOne({
      _id: id,
      ...ownerFilter(owner),
      expiresAt: { $gt: new Date() },
    }).session(session);
    if (!current) throw createError(404, 'Không tìm thấy hội thoại.');
    // A late explicit End request must not move the already-effective idle deadline.
    const finishAt = new Date(
      Math.min(endedAt.getTime(), current.lastActivityAt.getTime() + HOUR)
    );
    const doc = await AiConversation.findOneAndUpdate(
      {
        _id: id,
        ...ownerFilter(owner),
        status: 'active',
        expiresAt: { $gt: new Date() },
        ...(expectedActivity ? { lastActivityAt: expectedActivity } : {}),
      },
      {
        $set: {
          status: 'completed',
          endedAt: finishAt,
          busyUntil: null,
          activeRequestId: null,
          ...(owner.kind === 'guest'
            ? { expiresAt: guestExpiry(finishAt, finishAt) }
            : {}),
        },
      },
      { session, returnDocument: 'after' }
    );
    if (!doc) {
      const existing = await AiConversation.findOne({
        _id: id,
        ...ownerFilter(owner),
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (!existing) throw createError(404, 'Không tìm thấy hội thoại.');
      return { status: existing.status, endedAt: existing.endedAt };
    }
    await AiTurn.updateMany(
      { conversationId: id },
      {
        $set: {
          ...(owner.kind === 'guest'
            ? { expiresAt: guestExpiry(finishAt, finishAt) }
            : {}),
        },
      },
      { session }
    );
    await AiTurn.updateMany(
      { conversationId: id, status: 'processing' },
      { $set: { status: 'cancelled' } },
      { session }
    );
    return { status: doc.status, endedAt: doc.endedAt };
  });
  if (result.status === 'completed') cancelConversation(id);
  return result;
}
export async function beginTurn(
  id: string,
  owner: AiOwner,
  requestId: string,
  content: string,
  now = new Date()
) {
  await ownedConversation(id, owner, now);
  return mongoose.connection.transaction(async (session) => {
    const existing = await AiTurn.findOne({
      conversationId: id,
      requestId,
      expiresAt: { $gt: now },
    }).session(session);
    if (existing) {
      if (existing.content !== content)
        throw createError(409, 'Mã yêu cầu đã được dùng cho nội dung khác.');
      return { turn: existing, replay: true };
    }
    const conversation = await AiConversation.findOneAndUpdate(
      {
        _id: id,
        ...ownerFilter(owner),
        status: 'active',
        lastActivityAt: { $gt: new Date(now.getTime() - HOUR) },
        expiresAt: { $gt: now },
        $or: [{ busyUntil: null }, { busyUntil: { $lte: now } }],
      },
      {
        $set: {
          lastActivityAt: now,
          expiresAt: messageExpiry(owner.kind, now),
          busyUntil: new Date(now.getTime() + 90000),
          activeRequestId: requestId,
        },
      },
      { session, returnDocument: 'after' }
    );
    if (!conversation)
      throw createError(409, 'Hội thoại đã kết thúc hoặc đang trả lời.');
    await AiTurn.updateMany(
      { conversationId: id, status: 'processing' },
      { $set: { status: 'failed' } },
      { session }
    );
    if (owner.kind === 'guest')
      await AiTurn.updateMany(
        { conversationId: id },
        { $set: { expiresAt: guestExpiry(now) } },
        { session }
      );
    const [turn] = await AiTurn.create(
      [
        {
          conversationId: id,
          requestId,
          content,
          expiresAt: messageExpiry(owner.kind, now),
        },
      ],
      { session }
    );
    return { turn: turn!, replay: false };
  });
}

export async function cancelTurn(
  id: string,
  owner: AiOwner,
  requestId: string,
  content: string
) {
  const result = await mongoose.connection.transaction(async (session) => {
    // Serialize with beginTurn on the conversation, including cancellation
    // arriving before the send transaction has created its message.
    const conversation = await AiConversation.findOneAndUpdate(
      { _id: id, ...ownerFilter(owner), expiresAt: { $gt: new Date() } },
      { $inc: { __v: 1 } },
      { session, returnDocument: 'after' }
    );
    if (!conversation) throw createError(404, 'Conversation not found');
    let turn = await AiTurn.findOne({ conversationId: id, requestId }).session(
      session
    );
    if (turn && turn.content !== content)
      throw createError(409, 'Request ID belongs to different content');
    if (!turn) {
      if (conversation.status !== 'active')
        throw createError(409, 'Conversation ended');
      // Durable cancellation receipt: a delayed send replays cancelled and
      // never starts a paid generation, even on another API instance.
      const created = await AiTurn.create(
        [
          {
            conversationId: id,
            requestId,
            content,
            status: 'cancelled',
            expiresAt: conversation.expiresAt,
          },
        ],
        { session }
      );
      turn = created[0] ?? null;
    } else if (turn.status === 'processing') {
      turn = await AiTurn.findOneAndUpdate(
        { _id: turn._id, status: 'processing' },
        { $set: { status: 'cancelled' } },
        { session, returnDocument: 'after' }
      );
    }
    if (!turn) throw createError(409, 'Turn changed; reload history');
    if (turn.status === 'cancelled') {
      await AiConversation.updateOne(
        { _id: id, activeRequestId: requestId },
        { $set: { activeRequestId: null, busyUntil: null } },
        { session }
      );
    }
    return {
      requestId: turn.requestId,
      status: turn.status,
      answer: turn.answer,
      sources: turn.sources,
    };
  });
  if (result.status === 'cancelled') cancelRegisteredTurn(id, requestId);
  return result;
}
export async function socketTicket(owner: AiOwner) {
  const token = randomBytes(32).toString('hex');
  await AiSocketTicket.create({
    _id: digest(token),
    ownerKind: owner.kind,
    ownerId: owner.id,
    expiresAt: new Date(Date.now() + 30000),
  });
  return token;
}
export async function maintainConversations(now = new Date()) {
  // Effective end time is lastActivity+1h, even after worker/server downtime.
  const idle = await AiConversation.find({
    status: 'active',
    lastActivityAt: { $lte: new Date(now.getTime() - HOUR) },
    expiresAt: { $gt: now },
  })
    .limit(100)
    .lean();
  for (const doc of idle)
    await endConversation(
      String(doc._id),
      { kind: doc.ownerKind as AiOwner['kind'], id: doc.ownerId },
      new Date(doc.lastActivityAt.getTime() + HOUR),
      doc.lastActivityAt
    );
  await AiTurn.updateMany(
    {
      status: 'processing',
      updatedAt: { $lte: new Date(now.getTime() - 90000) },
    },
    { $set: { status: 'failed' } }
  );
  await AiTurn.deleteMany({ expiresAt: { $lte: now } });
  await AiConversation.deleteMany({ expiresAt: { $lte: now } });
}
export function startAiRetentionWorker() {
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (!pending)
      pending = maintainConversations()
        .catch(() => {
          console.error('AI retention failed');
        })
        .finally(() => {
          pending = undefined;
        });
  };
  tick();
  const timer = setInterval(tick, 60000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
export const customerRetentionDays = 30;
export const guestRetentionMs = DAY;
