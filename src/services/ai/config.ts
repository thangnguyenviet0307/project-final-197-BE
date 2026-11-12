export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const aiConfig = () => ({
  enabled: process.env['AI_ENABLED'] === 'true',
  indexingEnabled: process.env['AI_INDEX_ENABLED'] === 'true',
  riskEnabled: process.env['AI_RISK_ENABLED'] === 'true',
  model: process.env['AI_CHAT_MODEL'] || 'gemini-3.1-flash-lite',
  embeddingModel: process.env['AI_EMBEDDING_MODEL'] || 'gemini-embedding-001',
  vectorIndex: process.env['AI_VECTOR_INDEX'] || '',
  intentTokens: Number(process.env['AI_INTENT_MAX_OUTPUT_TOKENS'] || 1536),
  chatTokens: Number(process.env['AI_CHAT_MAX_OUTPUT_TOKENS'] || 2048),
  reasoningEffort: (process.env['AI_REASONING_EFFORT'] || 'low') as
    'low' | 'medium' | 'high',
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
