import { createChatAdapter } from './chat-completion.js';
import { aiConfig } from '../config.js';
export const openaiAdapter = createChatAdapter({
  baseURL: 'https://api.openai.com/v1/',
  tokenOptions: (model, tokens) => ({
    max_completion_tokens: tokens,
    store: false,
    ...(/^gpt-[56](?:[.-]|$)/.test(model)
      ? { reasoning_effort: aiConfig().reasoningEffort }
      : {}),
  }),
});
