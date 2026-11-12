import {
  runEmbeddingBuild,
  queueActiveEmbeddingRefresh,
} from './embedding-worker.js';
import { knowledgeSources } from './knowledge-sources.js';
import { createHash } from 'node:crypto';
import Product from '../../models/products/products.model.js';
import { AiChunk, AiIndexJob } from '../../models/ai/ai.model.js';
import { randomUUID } from 'node:crypto';
import { visibleCatalogFilter } from '../products/store-products.service.js';
import { plainText } from '../../utils/shared/plain-text.js';
import { aiProvider } from './providers/provider.js';
import {
  aiConfig,
  aiEmbeddingKey,
  resolveAiRuntime,
  withAiRuntime,
} from './config.js';
import {
  registerIndexWorker,
  markIndexWorkerTick,
  markIndexWorkerError,
} from './index-worker-control.js';
import mongoose, { type ClientSession } from 'mongoose';
export interface IndexContext {
  signal?: AbortSignal;
  lease?: string;
}
async function checkLease(context: IndexContext) {
  context.signal?.throwIfAborted();
  if (
    context.lease &&
    !(await AiIndexJob.exists({
      _id: 'sync',
      state: context.lease,
      leaseUntil: { $gt: new Date() },
    }))
  )
    throw new Error('Index lease lost');
}
async function indexWrite<T>(
  context: IndexContext,
  work: (session?: ClientSession) => Promise<T>
): Promise<T> {
  context.signal?.throwIfAborted();
  if (!context.lease) return work();
  const lease = context.lease;
  return mongoose.connection.transaction(async (session) => {
    context.signal?.throwIfAborted();
    const lock = await AiIndexJob.updateOne(
      { _id: 'sync', state: lease, leaseUntil: { $gt: new Date() } },
      { $set: { leaseUntil: new Date(Date.now() + 120000) } },
      { session }
    );
    if (!lock.matchedCount) throw new Error('Index lease lost');
    return work(session);
  });
}
export async function indexSource(
  key: string,
  text: string,
  title: string,
  href: string,
  context: IndexContext = {}
) {
  const content = plainText(text);
  const model = aiConfig().embeddingModel;
  let count = 0;
  for (let start = 0; start < content.length; start += 1000) {
    await checkLease(context);
    const part = count++;
    const value = content.slice(start, start + 1200);
    const hash = createHash('sha256')
      .update(model + ':' + value)
      .digest('hex');
    const exists = await AiChunk.exists({ key, part, hash });
    if (!exists) {
      const embedding = await aiProvider.embed(
        value,
        context.signal,
        'indexing'
      );
      await indexWrite(context, async (session) =>
        AiChunk.updateOne(
          { key, part },
          {
            $set: {
              hash,
              text: value,
              title,
              href,
              embedding,
              embeddingModel: model,
            },
          },
          { upsert: true, ...(session ? { session } : {}) }
        )
      );
    } else
      await indexWrite(context, async (session) =>
        AiChunk.updateOne(
          { key, part },
          { $set: { title, href } },
          { ...(session ? { session } : {}) }
        )
      );
  }
  await indexWrite(context, async (session) =>
    AiChunk.deleteMany(
      { key, part: { $gte: count } },
      { ...(session ? { session } : {}) }
    )
  );
}
export async function synchronizeKnowledge(context: IndexContext = {}) {
  await pruneHiddenProductChunks(context);
  for await (const source of knowledgeSources({
    ...context,
    check: () => checkLease(context),
  }))
    await indexSource(
      source.key,
      source.text,
      source.title,
      source.href,
      context
    );
  await pruneHiddenProductChunks(context);
}
export async function pruneHiddenProductChunks(context: IndexContext = {}) {
  const keys = await AiChunk.distinct('key', { key: /^product:/ });
  for (let start = 0; start < keys.length; start += 100) {
    await checkLease(context);
    const batch = keys.slice(start, start + 100);
    const valid = batch
      .map((k) => k.slice(8))
      .filter((id) => mongoose.isObjectIdOrHexString(id));
    const rows = await Product.find({
      _id: { $in: valid },
      is_active: true,
      $and: [await visibleCatalogFilter(context.signal)],
    })
      .select('_id')
      .setOptions({
        maxTimeMS: 5000,
        ...(context.signal ? { signal: context.signal } : {}),
      })
      .lean();
    const visible = new Set(rows.map((p) => 'product:' + p._id));
    const hidden = batch.filter((key) => !visible.has(key));
    if (hidden.length)
      await indexWrite(context, async (session) =>
        AiChunk.deleteMany(
          { key: { $in: hidden } },
          { ...(session ? { session } : {}) }
        )
      );
  }
}
export function startAiIndexWorker() {
  let pending: Promise<void> | undefined;
  let stopped = false;
  let wakeRequested = false;
  let controller: AbortController | undefined;
  const tick = () => {
    if (pending || stopped) return;
    markIndexWorkerTick();
    pending = resolveAiRuntime()
      .then((snapshot) =>
        withAiRuntime(snapshot, async () => {
          if (stopped) return;
          if (!aiConfig().enabled || !aiConfig().indexingEnabled) return;
          const versionController = new AbortController();
          controller = versionController;
          if (await runEmbeddingBuild(versionController.signal)) return;
          if (await queueActiveEmbeddingRefresh()) return;
          if (!aiConfig().vectorIndex || !aiEmbeddingKey()) return;
          try {
            await AiIndexJob.updateOne(
              { _id: 'sync' },
              { $setOnInsert: { nextRunAt: new Date(), state: 'queued' } },
              { upsert: true }
            );
          } catch {
            /* another process initialized it */
          }
          const lease = randomUUID();
          const startedAt = new Date();
          const job = await AiIndexJob.findOneAndUpdate(
            {
              _id: 'sync',
              nextRunAt: { $lte: new Date() },
              $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
            },
            {
              $set: { state: lease, leaseUntil: new Date(Date.now() + 120000) },
              $inc: { attempts: 1 },
            }
          );
          if (!job) return;
          const abort = new AbortController();
          controller = abort;
          const heartbeat = setInterval(() => {
            void AiIndexJob.updateOne(
              { _id: 'sync', state: lease },
              { $set: { leaseUntil: new Date(Date.now() + 120000) } }
            )
              .then((result) => {
                if (!result.matchedCount) abort.abort();
              })
              .catch(() => abort.abort());
          }, 30000);
          heartbeat.unref();
          try {
            await synchronizeKnowledge({ signal: abort.signal, lease });
            await mongoose.connection.transaction(async (session) => {
              const current = await AiIndexJob.findOne({
                _id: 'sync',
                state: lease,
                leaseUntil: { $gt: new Date() },
              }).session(session);
              if (!current) return;
              await AiIndexJob.updateOne(
                { _id: 'sync', state: lease },
                {
                  $set: {
                    state: 'completed',
                    leaseUntil: null,
                    lastSuccessAt: new Date(),
                    nextRunAt:
                      current.requestedAt && current.requestedAt > startedAt
                        ? new Date()
                        : new Date(Date.now() + 15 * 60000),
                  },
                },
                { session }
              );
            });
          } catch {
            await AiIndexJob.updateOne(
              { _id: 'sync', state: lease },
              {
                $set: {
                  state: 'failed',
                  leaseUntil: null,
                  nextRunAt: new Date(Date.now() + 5 * 60000),
                },
              }
            );
          } finally {
            clearInterval(heartbeat);
          }
        })
      )
      .catch(() => {
        markIndexWorkerError();
        console.error('AI indexing failed');
      })
      .finally(() => {
        pending = undefined;
        if (wakeRequested) {
          wakeRequested = false;
          tick();
        }
      });
  };
  const timer = setInterval(tick, 60000);
  const unregister = registerIndexWorker(() => {
    if (pending) wakeRequested = true;
    else tick();
  });
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    unregister();
    clearInterval(timer);
    controller?.abort();
    await pending;
  };
}
