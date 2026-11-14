export type EmbeddingProvider = 'gemini' | 'cloudflare' | 'openrouter';
export const embeddingModels = [
  {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dimensions: [768, 1536, 3072],
  },
  {
    provider: 'gemini',
    model: 'gemini-embedding-2',
    dimensions: [768, 1536, 3072],
  },
  {
    provider: 'cloudflare',
    model: '@cf/baai/bge-base-en-v1.5',
    dimensions: [768],
  },
  { provider: 'cloudflare', model: '@cf/baai/bge-m3', dimensions: [1024] },
  {
    provider: 'openrouter',
    model: 'nvidia/nemotron-3.5-embed-1b:free',
    dimensions: [2048],
  },
] as const;
export const embeddingConnectionIds = {
  gemini: '00000000-0000-4000-8000-000000000001',
  cloudflare: '00000000-0000-4000-8000-000000000002',
  openrouter: '00000000-0000-4000-8000-000000000003',
} as const;
export function embeddingKey(
  provider: string,
  env: NodeJS.ProcessEnv = process.env
) {
  if (!['gemini', 'cloudflare', 'openrouter'].includes(provider)) return '';
  if (
    provider === 'cloudflare' &&
    !/^[a-f0-9]{32}$/i.test(env['CLOUDFLARE_ACCOUNT_ID'] ?? '')
  )
    return '';
  return env[`${provider.toUpperCase()}_API_KEY`]?.trim() ?? '';
}
export function embeddingDefinition(model: string, provider?: string) {
  return embeddingModels.find(
    (item) => item.model === model && (!provider || item.provider === provider)
  );
}
export function validEmbedding(
  provider: string,
  model: string,
  dimensions: number
) {
  const definition = embeddingDefinition(model, provider);
  return (
    !!definition &&
    (definition.dimensions as readonly number[]).includes(dimensions)
  );
}
export function embeddingConnections(env: NodeJS.ProcessEnv = process.env) {
  return (Object.keys(embeddingConnectionIds) as EmbeddingProvider[])
    .filter((provider) => !!embeddingKey(provider, env))
    .map((provider) => ({
      id: embeddingConnectionIds[provider],
      name: `${provider === 'gemini' ? 'Gemini' : provider === 'cloudflare' ? 'Cloudflare' : 'OpenRouter'} (.env)`,
      provider,
      model: embeddingModels.find((item) => item.provider === provider)!.model,
      checkedOk: true,
      keyHint: '',
    }));
}
