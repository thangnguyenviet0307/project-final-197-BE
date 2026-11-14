import { createHash } from 'node:crypto';
import {
  compatibleChatModel,
  getProviderModels,
  type AiProviderId,
} from './providers/catalog.js';
export const ENV_EMBEDDING_ID = '00000000-0000-4000-8000-000000000001';
export interface EnvironmentConnection {
  id: string;
  provider: AiProviderId;
  model: string;
  apiKey: string;
  account: string;
}
function definitions(env: NodeJS.ProcessEnv) {
  const models = getProviderModels(env);
  const values: [AiProviderId, string, string][] = [
    ['gemini', 'GEMINI', models.gemini.join(',')],
    ['groq', 'GROQ', models.groq.join(',')],
    ['openrouter', 'OPENROUTER', models.openrouter.join(',')],
    ['cloudflare', 'CLOUDFLARE', models.cloudflare.join(',')],
  ];
  return values;
}
export function environmentConnections(
  env: NodeJS.ProcessEnv = process.env
): EnvironmentConnection[] {
  const order = (
    env['AI_PROVIDER_ORDER'] || 'gemini,groq,openrouter,cloudflare'
  )
    .split(',')
    .map((v) => v.trim());
  return definitions(env)
    .flatMap(([provider, prefix, models]) => {
      const apiKey = env[`${prefix}_API_KEY`]?.trim();
      if (!apiKey || !models || !order.includes(provider)) return [];
      if (
        provider === 'cloudflare' &&
        !/^[a-f0-9]{32}$/i.test(env['CLOUDFLARE_ACCOUNT_ID'] || '')
      )
        return [];
      const scope =
        env[`${prefix}_QUOTA_GROUP`]?.trim() ||
        (provider === 'cloudflare' ? env['CLOUDFLARE_ACCOUNT_ID']! : apiKey);
      const account = createHash('sha256')
        .update(`${provider}:${scope}`)
        .digest('hex');
      return [
        ...new Set(
          models
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        ),
      ].map((model, index) => {
        if (!compatibleChatModel(provider, model))
          throw new Error(`Invalid ${prefix}_CHAT_MODELS`);
        return {
          id: `${provider}:${index}`,
          provider,
          model,
          apiKey,
          account,
        };
      });
    })
    .sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
}

// Admin inventory includes unsupported-by-configuration entries without enabling them.
export function environmentRoutingInventory(
  env: NodeJS.ProcessEnv = process.env
) {
  const pool = environmentConnections(env);
  const providerModels = getProviderModels(env);
  const order = (
    env['AI_PROVIDER_ORDER'] || 'gemini,groq,openrouter,cloudflare'
  )
    .split(',')
    .map((v) => v.trim());
  return definitions(env)
    .flatMap(([provider, prefix, value]) => {
      const models = [
        ...new Set(
          (value || providerModels[provider][0])
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        ),
      ];
      return (models.length ? models : [providerModels[provider][0]]).map(
        (model) => {
          const position = pool.findIndex(
            (c) => c.provider === provider && c.model === model
          );
          const state = !env[`${prefix}_API_KEY`]?.trim()
            ? ('missing_key' as const)
            : provider === 'cloudflare' &&
                !/^[a-f0-9]{32}$/i.test(env['CLOUDFLARE_ACCOUNT_ID'] || '')
              ? ('missing_account' as const)
              : !order.includes(provider)
                ? ('excluded' as const)
                : ('ready' as const);
          return {
            provider,
            model,
            priority: position < 0 ? null : position + 1,
            state,
          };
        }
      );
    })
    .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
}
