import { environmentConnections } from './provider-environment.js';
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
  for (const name of [
    'AI_ENABLED',
    'AI_INDEX_ENABLED',
    'AI_RISK_ENABLED',
    'AI_FORCE_DISABLED',
  ]) {
    if (
      environment[name] !== undefined &&
      !['true', 'false'].includes(environment[name]!)
    )
      throw new Error(`Invalid ${name}`);
  }
  if (
    environment['AI_ENABLED'] === 'true' &&
    !environmentConnections(environment).length
  )
    throw new Error('AI_ENABLED requires a configured AI provider');
  if (
    environment['AI_INDEX_ENABLED'] === 'true' &&
    !environment['GEMINI_API_KEY']?.trim()
  )
    throw new Error('AI_INDEX_ENABLED requires GEMINI_API_KEY');
  const order = (
    environment['AI_PROVIDER_ORDER'] || 'gemini,groq,openrouter,cloudflare'
  )
    .split(',')
    .map((v) => v.trim());
  if (
    order.length > 4 ||
    new Set(order).size !== order.length ||
    order.some(
      (v) => !['gemini', 'groq', 'openrouter', 'cloudflare'].includes(v)
    )
  )
    throw new Error('Invalid AI_PROVIDER_ORDER');
  if (
    environment['CLOUDFLARE_API_KEY'] &&
    !/^[a-f0-9]{32}$/i.test(environment['CLOUDFLARE_ACCOUNT_ID'] || '')
  )
    throw new Error('Invalid CLOUDFLARE_ACCOUNT_ID');
  if (environmentConnections(environment).length > 12)
    throw new Error('Maximum 12 AI model candidates');
}
