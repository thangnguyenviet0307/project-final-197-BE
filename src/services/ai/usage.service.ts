import createError from 'http-errors';
import { AiCounter, AiRiskEvent } from '../../models/ai/ai.model.js';
import { DAY } from './config.js';
import { digest } from './identity.service.js';
export async function consumeUsage(
  key: string,
  maximum: number,
  duration: number,
  now = new Date()
) {
  const bucket = Math.floor(now.getTime() / duration);
  const id = `${key}:${bucket}`;
  try {
    await AiCounter.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          count: 0,
          expiresAt: new Date((bucket + 2) * duration),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (!(
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 11000
    ))
      throw error;
  }
  const result = await AiCounter.updateOne(
    { _id: id, count: { $lt: maximum } },
    { $inc: { count: 1 } }
  );
  return !!result.modifiedCount;
}
export async function recordRisk(
  key: string,
  event: string,
  reason: string,
  score: number,
  duration: number,
  now = new Date()
) {
  const dedupeKey = digest(
    `${key}:${event}:${Math.floor(now.getTime() / duration)}`
  );
  const update = {
    $setOnInsert: {
      actorHash: digest(key),
      event,
      reason,
      score,
      expiresAt: new Date(now.getTime() + 30 * DAY),
    },
    $inc: { occurrences: 1 },
  };
  try {
    await AiRiskEvent.updateOne(
      { dedupeKey },
      { ...update, $setOnInsert: { ...update.$setOnInsert, dedupeKey } },
      { upsert: true }
    );
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 11000
    ))
      throw error;
    await AiRiskEvent.updateOne({ dedupeKey }, { $inc: { occurrences: 1 } });
  }
}
export async function reserveUsage(
  key: string,
  maximum: number,
  duration: number,
  now = new Date()
) {
  if (!(await consumeUsage(key, maximum, duration, now))) {
    await recordRisk(
      key,
      'usage_limit',
      'AI request rate exceeded',
      60,
      duration,
      now
    );
    throw createError(429, 'Đã đạt giới hạn sử dụng. Vui lòng thử lại sau.', {
      aiCode: 'AI_USAGE_LIMIT',
    });
  }
}
async function incrementProviderCounter(key: string) {
  const bucket = Math.floor(Date.now() / DAY);
  const query = { _id: `${key}:${bucket}` };
  try {
    await AiCounter.updateOne(
      query,
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date((bucket + 2) * DAY) },
      },
      { upsert: true }
    );
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 11000
    ))
      throw error;
    await AiCounter.updateOne(query, { $inc: { count: 1 } });
  }
}
// Historical counters remain compatible; recording attempts never enforces a daily budget.
export async function reserveProviderCall(
  scope: 'interactive' | 'indexing' = 'interactive'
) {
  await incrementProviderCounter('provider-global');
  if (scope === 'indexing') await incrementProviderCounter('provider-indexing');
}
