import type { AiProviderId } from './providers/catalog.js';
import { AiEmbeddingGeneration } from '../../models/ai/ai-embedding.model.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import createError from 'http-errors';
import { AiSettings } from '../../models/ai/ai-settings.model.js';
import {
  environmentConnections,
  type EnvironmentConnection,
} from './provider-environment.js';
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const environmentAiConfig = () => ({
  source: 'environment' as 'environment' | 'database',
  revision: 0,
  provider: (environmentConnections()[0]?.provider ?? 'gemini') as AiProviderId,
  embeddingProvider: 'gemini' as 'gemini' | 'openai',
  embeddingDimensions: 1536,
  embeddingGeneration: null as string | null,
  semanticEnabled: !!process.env['AI_VECTOR_INDEX'],
  enabled: process.env['AI_ENABLED'] === 'true',
  indexingEnabled: process.env['AI_INDEX_ENABLED'] === 'true',
  riskEnabled: process.env['AI_RISK_ENABLED'] === 'true',
  model: environmentConnections()[0]?.model || 'gemini-3.1-flash-lite',
  embeddingModel: process.env['AI_EMBEDDING_MODEL'] || 'gemini-embedding-001',
  vectorIndex: process.env['AI_VECTOR_INDEX'] || '',
  intentTokens: Number(process.env['AI_INTENT_MAX_OUTPUT_TOKENS'] || 1536),
  chatTokens: Number(process.env['AI_CHAT_MAX_OUTPUT_TOKENS'] || 2048),
  reasoningEffort: (process.env['AI_REASONING_EFFORT'] || 'low') as
    'low' | 'medium' | 'high',
});
export type AiRuntimeConfig = ReturnType<typeof environmentAiConfig>;
export interface AiRuntime {
  config: AiRuntimeConfig;
  apiKey: string;
  embeddingApiKey?: string;
  connections?: EnvironmentConnection[];
  cloudflareAccountId?: string;
}
const runtime = new AsyncLocalStorage<AiRuntime>();
export const aiConfig = (): AiRuntimeConfig => {
  const config = runtime.getStore()?.config ?? environmentAiConfig();
  return process.env['AI_FORCE_DISABLED'] === 'true'
    ? { ...config, enabled: false }
    : config;
};
export const aiApiKey = () =>
  runtime.getStore()?.apiKey ?? environmentConnections()[0]?.apiKey ?? '';
export const aiEmbeddingKey = () =>
  runtime.getStore()?.embeddingApiKey ??
  process.env['GEMINI_API_KEY']?.trim() ??
  '';
export const aiRuntimeConnections = () =>
  runtime.getStore()?.connections ?? environmentConnections();
export const aiCloudflareAccountId = () =>
  runtime.getStore()?.cloudflareAccountId ??
  process.env['CLOUDFLARE_ACCOUNT_ID'] ??
  '';
export const aiRuntimeIdentity = () =>
  `${aiConfig().source}:${aiConfig().revision}:${aiConfig().provider}:${aiConfig().model}`;
export async function resolveAiRuntime(): Promise<AiRuntime> {
  const base = environmentAiConfig();
  if (mongoose.connection.readyState !== 1 && mongoose.connection.host)
    throw createError(503, 'AI configuration database is unavailable');
  const settings =
    mongoose.connection.readyState === 1
      ? await AiSettings.findById('global').maxTimeMS(5000).lean()
      : null;
  const generation = settings?.activeEmbeddingGenerationId
    ? await AiEmbeddingGeneration.findOne({
        _id: settings.activeEmbeddingGenerationId,
        state: 'ready',
      })
        .maxTimeMS(5000)
        .lean()
    : null;
  if (settings?.activeEmbeddingGenerationId && !generation)
    throw createError(503, 'Active embedding generation is unavailable');
  const connections = environmentConnections();
  const embeddingSupported = !generation || generation.provider === 'gemini';
  return {
    config: {
      ...base,
      source: settings ? 'database' : 'environment',
      revision: settings?.revision ?? 0,
      enabled: (settings?.enabled ?? base.enabled) && connections.length > 0,
      semanticEnabled:
        (settings?.semanticEnabled ?? base.semanticEnabled) &&
        embeddingSupported &&
        !!process.env['GEMINI_API_KEY']?.trim(),
      indexingEnabled: settings?.indexingEnabled ?? base.indexingEnabled,
      riskEnabled: settings?.riskEnabled ?? base.riskEnabled,
      embeddingProvider: 'gemini',
      embeddingModel: embeddingSupported
        ? (generation?.model ?? base.embeddingModel)
        : base.embeddingModel,
      embeddingDimensions: embeddingSupported
        ? (generation?.dimensions ?? base.embeddingDimensions)
        : base.embeddingDimensions,
      embeddingGeneration: embeddingSupported
        ? (generation?._id ?? null)
        : null,
      vectorIndex: embeddingSupported
        ? (generation?.indexName ?? base.vectorIndex)
        : '',
    },
    apiKey: connections[0]?.apiKey ?? '',
    embeddingApiKey: process.env['GEMINI_API_KEY']?.trim() ?? '',
    connections,
    cloudflareAccountId: process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '',
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
