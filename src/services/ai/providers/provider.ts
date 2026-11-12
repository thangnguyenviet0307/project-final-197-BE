import { aiConfig } from '../config.js';
import { geminiAdapter } from './gemini-adapter.js';
import { openaiAdapter } from './openai.provider.js';
import { xaiAdapter } from './xai.provider.js';
import { embed } from './embedding.js';
const adapters = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
  xai: xaiAdapter,
};
export const aiProvider = {
  embed,
  interpretQuery: (...args: Parameters<typeof geminiAdapter.interpretQuery>) =>
    adapters[aiConfig().provider].interpretQuery(...args),
  answerStream: (...args: Parameters<typeof geminiAdapter.answerStream>) =>
    adapters[aiConfig().provider].answerStream(...args),
};
