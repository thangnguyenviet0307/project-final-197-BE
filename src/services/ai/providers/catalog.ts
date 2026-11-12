export type AiProviderId = 'gemini' | 'openai' | 'xai';
export const providerModels = {
  gemini: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  openai: ['gpt-4.1-mini', 'gpt-5.4-mini'],
  xai: ['grok-4.7'],
} as const;
export function compatibleChatModel(provider: AiProviderId, model: string) {
  if (/embedding|image|audio|tts|transcribe|realtime|moderation/i.test(model))
    return false;
  return provider === 'gemini'
    ? /^gemini-[a-zA-Z0-9._-]{1,100}$/.test(model)
    : provider === 'openai'
      ? /^gpt-[a-zA-Z0-9._-]{1,100}$/.test(model)
      : /^grok-[a-zA-Z0-9._-]{1,100}$/.test(model);
}
