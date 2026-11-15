import {
  aiConfig,
  aiRuntimeConnections,
  aiCloudflareAccountId,
  withAiRuntime,
  aiEmbeddingKey,
} from '../config.js';
import { geminiAdapter } from './gemini-adapter.js';
import { createChatAdapter } from './chat-completion.js';
import { embed } from './embedding.js';
import { aiError } from '../failures.js';
import { available, coolDown, quotaFailure } from './quota.js';
import type { EnvironmentConnection } from '../provider-environment.js';
const tokens = (_model: string, count: number) => ({ max_tokens: count });
const adapters = {
  gemini: geminiAdapter,
  groq: createChatAdapter({
    baseURL: 'https://api.groq.com/openai/v1/',
    tokenOptions: tokens,
    jsonObject: true,
  }),
  openrouter: createChatAdapter({
    baseURL: 'https://openrouter.ai/api/v1/',
    tokenOptions: tokens,
    jsonObject: true,
  }),
  cloudflare: createChatAdapter({
    baseURL: () => {
      const account = aiCloudflareAccountId();
      if (!/^[a-f0-9]{32}$/i.test(account))
        throw aiError('AI_UNAVAILABLE', 503);
      return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/`;
    },
    tokenOptions: tokens,
    jsonObject: true,
  }),
};
function runtime(connection: EnvironmentConnection) {
  return {
    config: {
      ...aiConfig(),
      provider: connection.provider,
      model: connection.model,
    },
    apiKey: connection.apiKey,
    embeddingApiKey: aiEmbeddingKey(),
    connections: aiRuntimeConnections(),
    cloudflareAccountId: aiCloudflareAccountId(),
  };
}
async function interpretQuery(
  ...args: Parameters<typeof geminiAdapter.interpretQuery>
) {
  const signal = args[1];
  signal?.throwIfAborted();
  const connections = aiRuntimeConnections();
  if (!aiConfig().enabled || !connections.length)
    throw aiError('AI_UNAVAILABLE', 503);
  let failure: unknown = aiError('AI_RATE_LIMITED', 429);
  for (const connection of connections) {
    signal?.throwIfAborted();
    if (!(await available(connection, signal))) continue;
    try {
      return await withAiRuntime(runtime(connection), () =>
        adapters[connection.provider].interpretQuery(...args)
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (!quotaFailure(error)) throw error;
      failure = error;
      await coolDown(connection, error);
    }
  }
  throw failure;
}
async function* answerStream(
  ...args: Parameters<typeof geminiAdapter.answerStream>
) {
  const signal = args[3];
  signal.throwIfAborted();
  const connections = aiRuntimeConnections();
  if (!aiConfig().enabled || !connections.length)
    throw aiError('AI_UNAVAILABLE', 503);
  let failure: unknown = aiError('AI_RATE_LIMITED', 429);
  for (const connection of connections) {
    signal.throwIfAborted();
    if (!(await available(connection, signal))) continue;
    let delivered = false;
    const snapshot = runtime(connection);
    const stream = adapters[connection.provider].answerStream(...args);
    try {
      while (true) {
        const next = await withAiRuntime(snapshot, () => stream.next());
        signal.throwIfAborted();
        if (next.done) return;
        if (next.value) {
          delivered = true;
          yield next.value;
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!quotaFailure(error)) throw error;
      await coolDown(connection, error);
      if (delivered) throw error;
      failure = error;
    } finally {
      await withAiRuntime(snapshot, () => stream.return(undefined));
    }
  }
  throw failure;
}
export const aiProvider = { embed, interpretQuery, answerStream };
