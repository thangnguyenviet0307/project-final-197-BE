export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const aiConfig = () => ({
  enabled: process.env['AI_ENABLED'] === 'true',
  indexingEnabled: process.env['AI_INDEX_ENABLED'] === 'true',
  riskEnabled: process.env['AI_RISK_ENABLED'] === 'true',
  model: process.env['AI_CHAT_MODEL'] || 'gpt-5.4-mini',
  embeddingModel: process.env['AI_EMBEDDING_MODEL'] || 'text-embedding-3-small',
  vectorIndex: process.env['AI_VECTOR_INDEX'] || '',
  dailyCalls: Math.max(
    1,
    Math.min(100000, Number(process.env['AI_DAILY_CALL_LIMIT']) || 100)
  ),
});
export function guestExpiry(lastActivity: Date, endedAt?: Date | null): Date {
  return new Date((endedAt?.getTime() ?? lastActivity.getTime() + HOUR) + DAY);
}
export function messageExpiry(
  kind: 'guest' | 'customer',
  now: Date,
  endedAt?: Date | null
) {
  return kind === 'guest'
    ? guestExpiry(now, endedAt)
    : new Date(now.getTime() + 30 * DAY);
}
