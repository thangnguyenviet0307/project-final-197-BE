import { AiProviderState } from '../../../models/ai/ai-provider-state.model.js';
import type { EnvironmentConnection } from '../provider-environment.js';
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
export function quotaFailure(error: unknown) {
  const e = record(error);
  if (e['aiCode'] === 'AI_USAGE_LIMIT') return false;
  const nested = record(e['error']);
  return (
    e['status'] === 429 ||
    nested['code'] === 429 ||
    e['statusCode'] === 429 ||
    ['insufficient_quota', 'quota_exceeded', 'daily_limit_exceeded'].includes(
      String(e['code'] ?? nested['code'])
    )
  );
}
export function nextDailyReset(provider: string, now: Date) {
  if (provider !== 'gemini')
    return new Date((Math.floor(now.getTime() / 86400000) + 1) * 86400000);
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      format.formatToParts(date).map((p) => [p.type, Number(p.value)])
    );
  const today = parts(now);
  const target = Date.UTC(
    today['year']!,
    today['month']! - 1,
    today['day']! + 1
  );
  let guess = target;
  // Resolve the next Pacific midnight, including DST boundaries, without a fixed offset.
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    guess +=
      target -
      Date.UTC(
        p['year']!,
        p['month']! - 1,
        p['day']!,
        p['hour']!,
        p['minute']!,
        p['second']!
      );
  }
  return new Date(guess);
}
export function quotaCooldown(error: unknown, now = new Date(), provider = '') {
  const e = record(error),
    nested = record(e['error']);
  // Inspect only to classify; never persist/log the upstream message/body.
  const daily =
    /per.?day|daily|requestsperday|tokensperday|free_model_daily|neurons.*limit|3036|insufficient_quota/i.test(
      JSON.stringify(nested).slice(0, 20000) +
        String(e['message'] ?? '') +
        String(e['code'] ?? '')
    );
  const h = e['headers'];
  const headers =
    h instanceof Headers
      ? h
      : new Headers(
          h && typeof h === 'object' ? (h as Record<string, string>) : {}
        );
  const retry = headers.get('retry-after');
  const seconds =
    retry && /^\d+(\.\d+)?$/.test(retry)
      ? Number(retry) * 1000
      : retry
        ? Date.parse(retry) - now.getTime()
        : NaN;
  const reset = daily
    ? nextDailyReset(provider, now).getTime() - now.getTime()
    : 60000;
  const delay = Number.isFinite(seconds) && seconds > 0 ? seconds : reset;
  return {
    until: new Date(
      now.getTime() + Math.min(7 * 86400000, Math.max(1000, delay))
    ),
    reason: daily ? ('daily' as const) : ('rate' as const),
  };
}
function key(c: EnvironmentConnection, daily: boolean) {
  return daily ? `account:${c.account}` : `model:${c.account}:${c.model}`;
}
export async function available(
  c: EnvironmentConnection,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const blocked = await AiProviderState.exists({
    _id: { $in: [key(c, true), key(c, false)] },
    until: { $gt: new Date() },
  }).maxTimeMS(5000);
  signal?.throwIfAborted();
  return !blocked;
}
export async function coolDown(c: EnvironmentConnection, error: unknown) {
  const state = quotaCooldown(error, new Date(), c.provider);
  const id = key(c, state.reason === 'daily');
  try {
    await AiProviderState.updateOne(
      { _id: id },
      { $max: { until: state.until }, $set: { reason: state.reason } },
      { upsert: true, maxTimeMS: 5000 }
    );
  } catch (error) {
    if (record(error)['code'] !== 11000) throw error;
    await AiProviderState.updateOne(
      { _id: id },
      { $max: { until: state.until }, $set: { reason: state.reason } }
    ).maxTimeMS(5000);
  }
}
