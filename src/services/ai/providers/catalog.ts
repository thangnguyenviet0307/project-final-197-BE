export type AiProviderId = 'gemini' | 'groq' | 'openrouter' | 'cloudflare';
const defaultModels = {
  gemini: ['gemini-3.1-flash-lite'],
  groq: ['llama-3.3-70b-versatile'],
  openrouter: ['openrouter/free'],
  cloudflare: ['@cf/meta/llama-3.1-8b-instruct'],
} as const;
function modelList(
  value: string | undefined,
  fallback: readonly [string, ...string[]]
): [string, ...string[]] {
  const models = [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean)
    ),
  ];
  return models.length ? [models[0]!, ...models.slice(1)] : [...fallback];
}
export function getProviderModels(env: NodeJS.ProcessEnv = process.env) {
  return {
    gemini: modelList(
      env['GEMINI_CHAT_MODELS']?.trim() || env['AI_CHAT_MODEL'],
      defaultModels.gemini
    ),
    groq: modelList(env['GROQ_CHAT_MODELS'], defaultModels.groq),
    openrouter: modelList(
      env['OPENROUTER_CHAT_MODELS'],
      defaultModels.openrouter
    ),
    cloudflare: modelList(
      env['CLOUDFLARE_CHAT_MODELS'],
      defaultModels.cloudflare
    ),
  };
}
// Resolve lazily: dotenv may initialize after this module is imported.
export const providerModels = {
  get gemini() {
    return getProviderModels().gemini;
  },
  get groq() {
    return getProviderModels().groq;
  },
  get openrouter() {
    return getProviderModels().openrouter;
  },
  get cloudflare() {
    return getProviderModels().cloudflare;
  },
};
export function compatibleChatModel(provider: AiProviderId, model: string) {
  if (/embedding|image|audio|tts|transcribe|realtime|moderation/i.test(model))
    return false;
  if (!model || model.length > 160 || !/^[a-zA-Z0-9@/_.:-]+$/.test(model))
    return false;
  if (provider === 'gemini') return /^gemini-/.test(model);
  if (provider === 'openrouter')
    return model === 'openrouter/free' || model.endsWith(':free');
  if (provider === 'cloudflare') return model.startsWith('@cf/');
  return true;
}
