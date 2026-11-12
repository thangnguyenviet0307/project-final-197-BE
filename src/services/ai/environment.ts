export function validateAiEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const name of [
    'AI_INTENT_MAX_OUTPUT_TOKENS',
    'AI_CHAT_MAX_OUTPUT_TOKENS',
  ]) {
    const value = environment[name];
    if (
      value !== undefined &&
      (!/^\d+$/.test(value) || Number(value) < 256 || Number(value) > 16384)
    )
      throw new Error(`Invalid ${name}`);
  }
  if (
    environment['AI_REASONING_EFFORT'] !== undefined &&
    !['low', 'medium', 'high'].includes(environment['AI_REASONING_EFFORT'])
  )
    throw new Error('Invalid AI_REASONING_EFFORT');
  for (const name of ['AI_ENABLED', 'AI_INDEX_ENABLED', 'AI_RISK_ENABLED']) {
    if (
      environment[name] !== undefined &&
      !['true', 'false'].includes(environment[name]!)
    )
      throw new Error(`Invalid ${name}`);
  }
  const limit = environment['AI_DAILY_CALL_LIMIT'];
  if (
    limit !== undefined &&
    (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100000)
  )
    throw new Error('Invalid AI_DAILY_CALL_LIMIT');
  if (
    environment['AI_ENABLED'] === 'true' &&
    (!environment['GEMINI_API_KEY']?.trim() || !limit)
  )
    throw new Error(
      'AI_ENABLED requires GEMINI_API_KEY and AI_DAILY_CALL_LIMIT'
    );
  if (
    environment['AI_INDEX_ENABLED'] === 'true' &&
    !environment['AI_VECTOR_INDEX']?.trim()
  )
    throw new Error('AI_INDEX_ENABLED requires AI_VECTOR_INDEX');
}
