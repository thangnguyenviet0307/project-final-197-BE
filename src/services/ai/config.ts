import type { AiProviderId } from './providers/catalog.js';
import { AiEmbeddingGeneration } from '../../models/ai/ai-embedding.model.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import createError from 'http-errors';
import { AiSettings } from '../../models/ai/ai-settings.model.js';
import { decryptCredential } from './credentials.js';
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const environmentAiConfig = () => ({
  source: 'environment' as 'environment' | 'database',
  revision: 0,
  provider: 'gemini' as AiProviderId,
  embeddingProvider: 'gemini' as 'gemini' | 'openai',
  embeddingDimensions: 1536,
  embeddingGeneration: null as string | null,
  semanticEnabled: !!process.env['AI_VECTOR_INDEX'],
  enabled: process.env['AI_ENABLED'] === 'true',
  indexingEnabled: process.env['AI_INDEX_ENABLED'] === 'true',
  riskEnabled: process.env['AI_RISK_ENABLED'] === 'true',
  model: process.env['AI_CHAT_MODEL'] || 'gemini-3.1-flash-lite',
  embeddingModel: process.env['AI_EMBEDDING_MODEL'] || 'gemini-embedding-001',
  vectorIndex: process.env['AI_VECTOR_INDEX'] || '',
  intentTokens: Number(process.env['AI_INTENT_MAX_OUTPUT_TOKENS'] || 1536),
  chatTokens: Number(process.env['AI_CHAT_MAX_OUTPUT_TOKENS'] || 2048),
  reasoningEffort: (process.env['AI_REASONING_EFFORT'] || 'low') as
    'low' | 'medium' | 'high',
  dailyCalls: Math.max(
    1,
    Math.min(100000, Number(process.env['AI_DAILY_CALL_LIMIT']) || 100)
  ),
});
export type AiRuntimeConfig = ReturnType<typeof environmentAiConfig>;
export interface AiRuntime {
  config: AiRuntimeConfig;
  apiKey: string;
  embeddingApiKey?: string;
}
const runtime = new AsyncLocalStorage<AiRuntime>();
export const aiConfig = (): AiRuntimeConfig => {
  const config = runtime.getStore()?.config ?? environmentAiConfig();
  return process.env['AI_FORCE_DISABLED'] === 'true'
    ? { ...config, enabled: false }
    : config;
};
export const aiApiKey = () =>
  runtime.getStore()?.apiKey ?? process.env['GEMINI_API_KEY']?.trim() ?? '';
export const aiEmbeddingKey = () => {
  const stored = runtime.getStore();
  return stored
    ? (stored.embeddingApiKey ??
        (stored.config.provider === stored.config.embeddingProvider
          ? stored.apiKey
          : ''))
    : (process.env['GEMINI_API_KEY']?.trim() ?? '');
};
export const aiRuntimeIdentity = () =>
  `${aiConfig().source}:${aiConfig().revision}:${aiConfig().provider}:${aiConfig().model}`;
export async function resolveAiRuntime(): Promise<AiRuntime> {
  const base = environmentAiConfig();
  if (mongoose.connection.readyState !== 1 && mongoose.connection.host)
    throw createError(503, 'AI configuration database is unavailable');
  if (mongoose.connection.readyState !== 1)
    return {
      config: base,
      apiKey: process.env['GEMINI_API_KEY']?.trim() ?? '',
    };
  const settings = await AiSettings.findById('global')
    .select('+connections.encryptedKey')
    .maxTimeMS(5000)
    .lean();
  if (!settings)
    return {
      config: base,
      apiKey: process.env['GEMINI_API_KEY']?.trim() ?? '',
    };
  const active = settings.connections.find(
    (item) => item.id === settings.activeConnectionId
  );
  const generation = settings.activeEmbeddingGenerationId
    ? await AiEmbeddingGeneration.findOne({
        _id: settings.activeEmbeddingGenerationId,
        state: 'ready',
      })
        .maxTimeMS(5000)
        .lean()
    : null;
  if (settings.activeEmbeddingGenerationId && !generation)
    throw createError(503, 'Active embedding generation is unavailable');
  const legacyId =
    settings.legacyEmbeddingConnectionId ??
    (active?.provider === 'gemini' ? active.id : null);
  const embeddingConnection = settings.connections.find(
    (item) => item.id === (generation?.connectionId ?? legacyId)
  );
  if (
    generation &&
    (!embeddingConnection ||
      embeddingConnection.provider !== generation.provider)
  )
    throw createError(503, 'Embedding credential is unavailable');
  return {
    config: {
      ...base,
      source: 'database',
      revision: settings.revision,
      provider: active?.provider ?? base.provider,
      embeddingProvider: generation?.provider ?? 'gemini',
      embeddingModel: generation?.model ?? base.embeddingModel,
      embeddingDimensions: generation?.dimensions ?? base.embeddingDimensions,
      embeddingGeneration: generation?._id ?? null,
      vectorIndex: generation?.indexName ?? base.vectorIndex,
      enabled: settings.enabled && !!active,
      semanticEnabled: settings.semanticEnabled,
      indexingEnabled: settings.indexingEnabled,
      riskEnabled: settings.riskEnabled,
      dailyCalls: settings.dailyCalls,
      model: active?.model ?? base.model,
    },
    embeddingApiKey: embeddingConnection?.encryptedKey
      ? decryptCredential(
          embeddingConnection.encryptedKey,
          embeddingConnection.id
        )
      : '',
    apiKey: active?.encryptedKey
      ? decryptCredential(active.encryptedKey, active.id)
      : '',
  };
}
export async function withAiConfig<T>(work: () => T | Promise<T>): Promise<T> {
  if (runtime.getStore()) return work();
  if (mongoose.connection.readyState !== 1) {
    if (mongoose.connection.host)
      throw createError(503, 'AI configuration database is unavailable');
    return work();
  }
  return runtime.run(await resolveAiRuntime(), work);
}
export function withAiRuntime<T>(value: AiRuntime, work: () => T | Promise<T>) {
  return runtime.run(value, work);
}
export function guestExpiry(lastActivity: Date, endedAt?: Date | null): Date {
  return new Date((endedAt?.getTime() ?? lastActivity.getTime() + HOUR) + DAY);
}
export function messageExpiry(
  kind: 'guest' | 'customer',
  now: Date,
  endedAt?: Date | null
) {
  return kind === 'guest'
    ? guestExpiry(now, endedAt)
    : new Date(now.getTime() + 30 * DAY);
}
