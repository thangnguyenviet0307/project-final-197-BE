import { createChatAdapter } from './chat-completion.js';
import { aiConfig } from '../config.js';
export const geminiAdapter = createChatAdapter({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  tokenOptions: (_model, tokens) => ({
    max_tokens: tokens,
    reasoning_effort: aiConfig().reasoningEffort,
  }),
});
