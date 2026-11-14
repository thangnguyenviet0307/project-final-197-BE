import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { AiRoutingRun } from '../../models/ai/ai-routing-run.model.js';
import type { EnvironmentConnection } from './provider-environment.js';
type RoutingKind = 'activation' | 'chat' | 'provider';
type RunStatus = 'completed' | 'failed' | 'cancelled';
const operations = new AsyncLocalStorage<{
  kind: RoutingKind;
  started?: Promise<string | null>;
  id?: string | null;
  status?: RunStatus;
}>();
// A logical operation owns its phases; adapter runtime snapshots do not create new runs.
export async function withRoutingOperation<T>(
  kind: RoutingKind,
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (operations.getStore()) return work();
  const operation: NonNullable<ReturnType<typeof operations.getStore>> = {
    kind,
  };
  return operations.run(operation, async () => {
    try {
      const result = await work();
      if (operation.started) operation.id = await operation.started;
      await finishRoutingRun(
        operation.id ?? null,
        signal?.aborted ? 'cancelled' : (operation.status ?? 'completed'),
        true
      );
      return result;
    } catch (error) {
      if (operation.started) operation.id = await operation.started;
      await finishRoutingRun(
        operation.id ?? null,
        signal?.aborted ? 'cancelled' : 'failed',
        true
      );
      throw error;
    }
  });
}
// Observability is best effort and must never interrupt a customer's answer.
async function createRun(stage: 'intent' | 'answer', kind: RoutingKind) {
  if (mongoose.connection.readyState !== 1) return null;
  const id = randomUUID();
  try {
    await AiRoutingRun.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          kind,
          stage,
          status: 'running',
          attempts: [],
          expiresAt: new Date(Date.now() + 86400000),
        },
      },
      { upsert: true, maxTimeMS: 1000 }
    );
    return id;
  } catch {
    return null;
  }
}
export async function startRoutingRun(stage: 'intent' | 'answer') {
  const operation = operations.getStore();
  if (!operation) return createRun(stage, 'provider');
  operation.started ??= createRun(stage, operation.kind);
  operation.id = await operation.started;
  if (operation.id)
    await AiRoutingRun.updateOne(
      { _id: operation.id },
      { $set: { stage } },
      { maxTimeMS: 1000 }
    ).catch(() => {});
  return operation.id;
}
export async function startRoutingAttempt(
  id: string | null,
  connection: EnvironmentConnection,
  phase: 'intent' | 'answer'
) {
  if (!id) return;
  await AiRoutingRun.updateOne(
    { _id: id },
    {
      $push: {
        attempts: {
          phase,
          provider: connection.provider,
          model: connection.model,
          status: 'running',
          startedAt: new Date(),
        },
      },
    },
    { maxTimeMS: 1000 }
  ).catch(() => {});
}
export async function finishRoutingAttempt(
  id: string | null,
  status: 'completed' | 'quota' | 'failed' | 'cancelled'
) {
  if (!id) return;
  await AiRoutingRun.updateOne(
    { _id: id },
    {
      $set: {
        'attempts.$[attempt].status': status,
        'attempts.$[attempt].finishedAt': new Date(),
      },
    },
    { arrayFilters: [{ 'attempt.status': 'running' }], maxTimeMS: 1000 }
  ).catch(() => {});
}
export async function finishRoutingRun(
  id: string | null,
  status: 'completed' | 'failed' | 'cancelled',
  force = false
) {
  if (!id) return;
  const operation = operations.getStore();
  if (!force && operation?.id === id) {
    operation.status = status;
    return;
  }
  await AiRoutingRun.updateOne(
    { _id: id },
    { $set: { status } },
    { maxTimeMS: 1000 }
  ).catch(() => {});
}
export async function readRoutingMonitor() {
  const rows = await AiRoutingRun.find({ expiresAt: { $gt: new Date() } })
    .sort({ updatedAt: -1 })
    .limit(30)
    .maxTimeMS(5000)
    .select('kind stage status attempts createdAt updatedAt')
    .lean();
  const stale = Date.now() - 120000;
  return {
    runs: rows.map((run) => ({
      ...run,
      status:
        run.status === 'running' && run.updatedAt.getTime() < stale
          ? 'interrupted'
          : run.status,
    })),
    sampledAt: new Date(),
  };
}
