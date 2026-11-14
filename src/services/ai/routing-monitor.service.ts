import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { AiRoutingRun } from '../../models/ai/ai-routing-run.model.js';
import type { EnvironmentConnection } from './provider-environment.js';
// Observability is best effort and must never interrupt a customer's answer.
export async function startRoutingRun(stage: 'intent' | 'answer') {
  if (mongoose.connection.readyState !== 1) return null;
  const id = randomUUID();
  try {
    await AiRoutingRun.updateOne(
      { _id: id },
      {
        $setOnInsert: {
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
export async function startRoutingAttempt(
  id: string | null,
  connection: EnvironmentConnection
) {
  if (!id) return;
  await AiRoutingRun.updateOne(
    { _id: id },
    {
      $push: {
        attempts: {
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
  status: 'completed' | 'failed' | 'cancelled'
) {
  if (!id) return;
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
    .select('stage status attempts createdAt updatedAt')
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
