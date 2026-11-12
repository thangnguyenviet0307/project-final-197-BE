import { AiConversation, AiTurn } from '../../models/ai/ai.model.js';
import type { AiOwner, AiEvent } from '../../types/ai/ai.types.js';
import { beginTurn } from './conversation.service.js';
import { retrieveKnowledge, productCardsByIds } from './retrieval.service.js';
import { aiProvider } from './providers/gemini.provider.js';
import { reserveUsage } from './usage.service.js';
import { registerTurn } from './active-turns.js';
import { aiError, reportAiFailure, type AiStage } from './failures.js';
export async function runChat(
  owner: AiOwner,
  input: { conversationId: string; requestId: string; content: string },
  signal: AbortSignal,
  emit: (event: AiEvent) => void
) {
  signal.throwIfAborted();
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
    if (turn.status !== 'completed') {
      send(turn.status === 'processing' ? 'chat:processing' : 'chat:error', {
        status: turn.status,
        ...(turn.error
          ? {
              code: turn.error.code,
              message: turn.error.message,
              retryable: turn.error.retryable,
            }
          : {}),
      });
      return;
    }
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
  const release = registerTurn(
    input.conversationId,
    input.requestId,
    controller
  );
  signal = AbortSignal.any([signal, controller.signal]);
  const monitor = setInterval(() => {
    void Promise.all([
      AiConversation.exists({
        _id: input.conversationId,
        status: 'active',
        activeRequestId: input.requestId,
      }),
      AiTurn.exists({ _id: turn._id, status: 'processing' }),
    ])
      .then(([active, processing]) => {
        if (!active || !processing) controller.abort();
      })
      .catch(() => controller.abort());
  }, 1000);
  monitor.unref();
  send('chat:accepted');
  let answer = '';
  let stage: AiStage = 'retrieval';
  let status: 'completed' | 'cancelled' | 'failed' = 'failed';
  try {
    signal.throwIfAborted();
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
    const previous = old.findLast(
      (t) => t.searchContext || t.productIds.length > 0
    );
    const previousProductIds = (previous?.productIds ?? []).map(String);
    const previousProducts = await productCardsByIds(
      previousProductIds,
      signal
    );
    const previousSearch = previous?.searchContext;
    const knowledge = await retrieveKnowledge(input.content, signal, {
      previousProducts,
      previousProductIds,
      ...(previousSearch
        ? {
            previousSearch: {
              q: previousSearch.q ?? '',
              page: 1,
              limit: 6,
              brand: previousSearch.brand ?? undefined,
              category: previousSearch.category ?? undefined,
              minPrice: previousSearch.minPrice ?? undefined,
              maxPrice: previousSearch.maxPrice ?? undefined,
            },
          }
        : {}),
    });
    signal.throwIfAborted();
    send('chat:status', 'Đang soạn trả lời…');
    stage = 'generation';
    if (knowledge.clarification) answer = knowledge.clarification;
    else
      for await (const delta of aiProvider.answerStream(
        input.content,
        JSON.stringify(knowledge),
        history,
        signal
      )) {
        signal.throwIfAborted();
        if (answer.length + delta.length > 16000)
          throw aiError('AI_OUTPUT_LIMIT');
        answer += delta;
        send('chat:delta', delta);
      }
    if (!answer.trim()) throw aiError('AI_INVALID_RESPONSE');
    const active = await AiConversation.exists({
      _id: input.conversationId,
      status: 'active',
      activeRequestId: input.requestId,
    });
    if (!active) throw new Error('Conversation ended');
    signal.throwIfAborted();
    stage = 'persistence';
    const saved = await AiTurn.updateOne(
      { _id: turn._id, status: 'processing' },
      {
        $set: {
          answer,
          status: 'completed',
          searchContext: knowledge.searchContext,
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
  } catch (error) {
    let failure = reportAiFailure(
      signal.aborted && signal.reason?.aiCode === 'AI_TIMEOUT'
        ? signal.reason
        : error,
      stage,
      input.requestId
    );
    let confirmed = false;
    status =
      signal.aborted && signal.reason?.aiCode !== 'AI_TIMEOUT'
        ? 'cancelled'
        : 'failed';
    try {
      await AiTurn.updateOne(
        { _id: turn._id, status: 'processing' },
        {
          $set: {
            answer,
            status,
            ...(status === 'failed' ? { error: failure } : {}),
          },
        }
      );
      const current = await AiTurn.findById(turn._id).select('status');
      if (current?.status === 'cancelled' || current?.status === 'failed') {
        status = current.status;
        confirmed = true;
      }
    } catch (storageError) {
      failure = reportAiFailure(storageError, 'persistence', input.requestId);
    }
    send('chat:error', {
      message: status === 'cancelled' ? 'Đã dừng trả lời.' : failure.message,
      ...(status === 'failed'
        ? { code: failure.code, retryable: failure.retryable }
        : {}),
      ...(confirmed ? { status } : {}),
    });
  } finally {
    clearInterval(monitor);
    release();
    try {
      await AiConversation.updateOne(
        { _id: input.conversationId, activeRequestId: input.requestId },
        { $set: { busyUntil: null, activeRequestId: null } }
      );
    } catch (error) {
      reportAiFailure(error, 'persistence', input.requestId);
    }
  }
}
