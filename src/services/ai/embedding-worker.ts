import { createHash, randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import {
  AiEmbeddingGeneration,
  AiEmbeddingChunk,
} from '../../models/ai/ai-embedding.model.js';
import { AiSettings } from '../../models/ai/ai-settings.model.js';
import { aiConfig, withAiRuntime } from './config.js';
import { aiProvider } from './providers/provider.js';
import { knowledgeSourceProvider } from './knowledge-sources.js';
import { plainText } from '../../utils/shared/plain-text.js';
import {
  activateEmbeddingVersion,
  changeEmbeddingVersion,
  createEmbeddingVersion,
  generationRuntime,
} from './embedding-versions.service.js';
import {
  vectorInfrastructure,
  VectorIndexPending,
  EXACT_VECTOR_LIMIT,
  ExactVectorCapacityError,
  isExactVectorIndex,
} from './vector-infrastructure.js';
import { classifyAiFailure } from './failures.js';

async function write<T>(
  id: string,
  lease: string,
  signal: AbortSignal,
  work: (session: ClientSession) => Promise<T>
) {
  signal.throwIfAborted();
  return mongoose.connection.transaction(async (session) => {
    signal.throwIfAborted();
    const lock = await AiEmbeddingGeneration.updateOne(
      {
        _id: id,
        leaseId: lease,
        state: { $in: ['queued', 'building', 'verifying'] },
        leaseUntil: { $gt: new Date() },
      },
      { $set: { leaseUntil: new Date(Date.now() + 120000) } },
      { session }
    );
    if (!lock.matchedCount) throw new Error('Embedding build lease lost');
    return work(session);
  });
}
export async function runEmbeddingBuild(parentSignal?: AbortSignal) {
  if (!aiConfig().enabled || !aiConfig().indexingEnabled) return false;
  const lease = randomUUID();
  const generation = await AiEmbeddingGeneration.findOneAndUpdate(
    {
      state: { $in: ['queued', 'building', 'verifying'] },
      nextRunAt: { $lte: new Date() },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
    },
    { $set: { leaseId: lease, leaseUntil: new Date(Date.now() + 120000) } },
    { returnDocument: 'after', sort: { createdAt: 1 } }
  ).lean();
  if (!generation) return false;
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([controller.signal, parentSignal])
    : controller.signal;
  const heartbeat = setInterval(() => {
    void AiEmbeddingGeneration.updateOne(
      {
        _id: generation._id,
        leaseId: lease,
        state: { $in: ['queued', 'building', 'verifying'] },
      },
      { $set: { leaseUntil: new Date(Date.now() + 120000) } }
    )
      .then((value) => {
        if (!value.matchedCount) controller.abort();
      })
      .catch(() => controller.abort());
  }, 30000);
  heartbeat.unref();
  let phase: 'index' | 'embedding' = 'index';
  try {
    const indexId = await vectorInfrastructure.ensure(generation, true);
    phase = 'embedding';
    await withAiRuntime(await generationRuntime(generation._id), async () => {
      if (generation.indexId !== indexId)
        await write(generation._id, lease, signal, (session) =>
          AiEmbeddingChunk.updateMany(
            { generation: generation._id },
            { $set: { verified: false } },
            { session }
          )
        );
      if (generation.state !== 'verifying') {
        const reusable = await AiEmbeddingGeneration.find({
          state: 'ready',
          provider: generation.provider,
          model: generation.model,
          dimensions: generation.dimensions,
        })
          .select('_id')
          .lean();
        await write(generation._id, lease, signal, (session) =>
          AiEmbeddingGeneration.updateOne(
            { _id: generation._id },
            { $set: { state: 'building', indexId, failureCode: null } },
            { session }
          )
        );
        let totalChunks = 0;
        for await (const source of knowledgeSourceProvider.iterate({
          signal,
        })) {
          const text = plainText(source.text);
          let part = 0;
          for (let offset = 0; offset < text.length; offset += 1000) {
            signal.throwIfAborted();
            if (
              ++totalChunks > EXACT_VECTOR_LIMIT &&
              isExactVectorIndex(generation.indexName)
            )
              throw new ExactVectorCapacityError(
                'Exact vector capacity exceeded'
              );
            const value = text.slice(offset, offset + 1200);
            const hash = createHash('sha256')
              .update(
                `${generation.provider}:${generation.model}:${generation.dimensions}:${value}`
              )
              .digest('hex');
            const existing = await AiEmbeddingChunk.exists({
              generation: generation._id,
              key: source.key,
              part,
              hash,
            });
            const cached =
              !existing && reusable.length
                ? await AiEmbeddingChunk.findOne({
                    hash,
                    generation: { $in: reusable.map((item) => item._id) },
                  })
                    .select('+embedding')
                    .lean()
                : null;
            const embedding = existing
              ? undefined
              : (cached?.embedding ??
                (await aiProvider.embed(value, signal, 'indexing')));
            if (
              embedding &&
              (embedding.length !== generation.dimensions ||
                embedding.some((n) => !Number.isFinite(n)) ||
                Math.hypot(...embedding) === 0)
            )
              throw new Error('Invalid embedding dimensions');
            await write(generation._id, lease, signal, (session) =>
              AiEmbeddingChunk.updateOne(
                { generation: generation._id, key: source.key, part },
                {
                  $set: {
                    hash,
                    text: value,
                    title: source.title,
                    href: source.href,
                    scanToken: lease,
                    ...(embedding ? { embedding, verified: false } : {}),
                  },
                },
                { upsert: true, session }
              )
            );
            part++;
          }
        }
        await write(generation._id, lease, signal, (session) =>
          AiEmbeddingChunk.deleteMany(
            { generation: generation._id, scanToken: { $ne: lease } },
            { session }
          )
        );
      }
      phase = 'index';
      const chunks = await AiEmbeddingChunk.countDocuments({
        generation: generation._id,
      });
      await write(generation._id, lease, signal, (session) =>
        AiEmbeddingGeneration.updateOne(
          { _id: generation._id },
          { $set: { state: 'verifying', chunks, indexId } },
          { session }
        )
      );
      let verified = await AiEmbeddingChunk.countDocuments({
        generation: generation._id,
        verified: true,
      });
      const cursor = AiEmbeddingChunk.find({
        generation: generation._id,
        verified: false,
      })
        .select('+embedding')
        .cursor();
      try {
        for await (const chunk of cursor) {
          signal.throwIfAborted();
          if (
            !(await vectorInfrastructure.visible(generation, {
              _id: chunk._id,
              embedding: chunk.embedding,
              hash: chunk.hash,
            }))
          )
            throw new VectorIndexPending();
          await write(generation._id, lease, signal, (session) =>
            AiEmbeddingChunk.updateOne(
              { _id: chunk._id },
              { $set: { verified: true } },
              { session }
            )
          );
          verified++;
          await write(generation._id, lease, signal, (session) =>
            AiEmbeddingGeneration.updateOne(
              { _id: generation._id },
              { $set: { verified } },
              { session }
            )
          );
        }
      } finally {
        await cursor.close();
      }
      signal.throwIfAborted();
      if (
        verified !== chunks ||
        (await vectorInfrastructure.ensure(generation)) !== indexId
      )
        throw new VectorIndexPending();
      await write(generation._id, lease, signal, (session) =>
        AiEmbeddingGeneration.updateOne(
          { _id: generation._id },
          {
            $set: {
              state: 'ready',
              verified,
              failureCode: null,
              finishedAt: new Date(),
              leaseId: null,
              leaseUntil: null,
            },
            $inc: { revision: 1 },
          },
          { session }
        )
      );
    });
    if (generation.autoActivate) {
      const settings = await AiSettings.findById('global').lean();
      if (
        settings?.enabled &&
        settings.indexingEnabled &&
        settings.activeEmbeddingGenerationId === generation.parentId &&
        (settings.embeddingEpoch ?? 0) === generation.parentEpoch
      )
        await activateEmbeddingVersion(
          generation._id,
          settings.revision,
          'worker',
          generation.parentId,
          generation.parentEpoch
        );
    }
  } catch (error) {
    const pending = error instanceof VectorIndexPending;
    const failure = classifyAiFailure(error, 'embedding').code;
    const resumable =
      signal.aborted ||
      ['AI_USAGE_LIMIT', 'AI_RATE_LIMITED', 'AI_TIMEOUT'].includes(failure);
    const retryAt =
      failure === 'AI_USAGE_LIMIT'
        ? new Date(new Date().setUTCHours(24, 0, 5, 0))
        : new Date(Date.now() + (resumable ? 5 * 60000 : 30000));
    const chunks = await AiEmbeddingChunk.countDocuments({
      generation: generation._id,
    });
    await AiEmbeddingGeneration.updateOne(
      { _id: generation._id, leaseId: lease },
      {
        $set: {
          ...(pending || resumable ? {} : { state: 'failed' }),
          chunks,
          failureCode: pending
            ? 'AI_VECTOR_INDEX_PENDING'
            : signal.aborted
              ? 'AI_INDEX_INTERRUPTED'
              : error instanceof ExactVectorCapacityError
                ? 'AI_VECTOR_CAPACITY'
                : phase === 'index'
                  ? 'AI_VECTOR_INDEX_ERROR'
                  : failure,
          leaseId: null,
          leaseUntil: null,
          nextRunAt: retryAt,
        },
      }
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

export async function queueActiveEmbeddingRefresh(force = false) {
  let settings = await AiSettings.findById('global').lean();
  if (!settings?.activeEmbeddingGenerationId) return false;
  const active = await AiEmbeddingGeneration.findById(
    settings.activeEmbeddingGenerationId
  ).lean();
  if (
    !active ||
    (!force &&
      (!active.finishedAt ||
        active.finishedAt.getTime() > Date.now() - 15 * 60000))
  )
    return true;
  const pending = await AiEmbeddingGeneration.findOne({
    parentId: active._id,
    state: { $in: ['queued', 'building', 'verifying', 'failed'] },
  }).lean();
  if (pending) {
    if (force && pending.state === 'failed')
      await changeEmbeddingVersion(
        pending._id,
        settings.revision,
        'worker',
        'retry'
      );
    return true;
  }
  if ((await AiEmbeddingGeneration.countDocuments()) >= 20) {
    // Only remove derived, automatically generated exact-search snapshots.
    // Manual versions and the recent rollback window are always retained.
    const expired = await AiEmbeddingGeneration.findOne({
      _id: { $ne: active._id },
      autoActivate: true,
      state: 'ready',
      indexName: /^ai_exact_/,
      lastDeactivatedAt: { $lte: new Date(Date.now() - 5 * 60000) },
    })
      .sort({ createdAt: 1 })
      .lean();
    if (!expired) return true;
    await changeEmbeddingVersion(
      expired._id,
      settings.revision,
      'worker',
      'delete'
    );
    settings = await AiSettings.findById('global').lean();
    if (!settings || settings.activeEmbeddingGenerationId !== active._id)
      return true;
  }
  await createEmbeddingVersion(
    {
      revision: settings.revision,
      connectionId: active.connectionId,
      engine: isExactVectorIndex(active.indexName) ? 'exact' : 'atlas',
      model: active.model as
        | 'gemini-embedding-001'
        | 'gemini-embedding-2'
        | 'text-embedding-3-small'
        | 'text-embedding-3-large',
      dimensions: active.dimensions as 768 | 1536 | 3072,
    },
    'worker',
    true,
    active._id
  );
  return true;
}
