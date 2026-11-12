import { createChatAdapter } from './chat-completion.js';
export const xaiAdapter = createChatAdapter({
  baseURL: 'https://api.x.ai/v1/',
  tokenOptions: (_model, tokens) => ({ max_tokens: tokens }),
});
