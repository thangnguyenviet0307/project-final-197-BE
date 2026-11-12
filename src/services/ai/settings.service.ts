import { AiEmbeddingGeneration } from '../../models/ai/ai-embedding.model.js';
import { providerModels, type AiProviderId } from './providers/catalog.js';
import { randomUUID } from 'node:crypto';
import createError from 'http-errors';
import type { z } from 'zod';
import { AiSettings } from '../../models/ai/ai-settings.model.js';
import {
  connectionInput,
  settingsInput,
} from '../../validations/ai/ai-settings.validation.js';
import {
  credentialsReady,
  encryptCredential,
  decryptCredential,
} from './credentials.js';
import { environmentAiConfig, withAiRuntime } from './config.js';
import { aiProvider } from './providers/provider.js';
import { classifyAiFailure } from './failures.js';

interface ConnectionRecord {
  id: string;
  name: string;
  provider: AiProviderId;
  model: string;
  encryptedKey: string;
  keyHint: string;
  checkedAt?: Date | null;
  checkedOk: boolean;
  checkCode?: string | null;
}
interface Settings {
  revision: number;
  enabled: boolean;
  semanticEnabled: boolean;
  indexingEnabled: boolean;
  riskEnabled: boolean;
  dailyCalls: number;
  activeConnectionId: string | null;
  activeEmbeddingGenerationId?: string | null;
  embeddingEpoch?: number;
  legacyEmbeddingConnectionId?: string | null;
  connections: ConnectionRecord[];
  audit: {
    action?: string | null;
    actor?: string | null;
    at?: Date | null;
    connectionId?: string | null;
  }[];
}
const load = () =>
  AiSettings.findById('global')
    .select('+connections.encryptedKey')
    .maxTimeMS(5000)
    .lean<Settings>();
const defaults = () => {
  const config = environmentAiConfig();
  return {
    enabled: config.enabled,
    semanticEnabled: config.semanticEnabled,
    indexingEnabled: config.indexingEnabled,
    riskEnabled: config.riskEnabled,
    dailyCalls: config.dailyCalls,
    activeConnectionId: null as string | null,
  };
};
export async function readAiSettings() {
  const doc = await AiSettings.findById('global').maxTimeMS(5000).lean();
  const hasVersions = !!(await AiEmbeddingGeneration.exists({}));
  return {
    source: doc ? 'database' : 'environment',
    revision: doc?.revision ?? 0,
    encryptionReady: credentialsReady(),
    vectorReady: !!environmentAiConfig().vectorIndex || hasVersions,
    semanticReady:
      !!doc?.activeEmbeddingGenerationId || !!environmentAiConfig().vectorIndex,
    emergencyDisabled: process.env['AI_FORCE_DISABLED'] === 'true',
    settings: doc
      ? {
          enabled: doc.enabled,
          semanticEnabled: doc.semanticEnabled,
          indexingEnabled: doc.indexingEnabled,
          riskEnabled: doc.riskEnabled,
          dailyCalls: doc.dailyCalls,
          activeConnectionId: doc.activeConnectionId,
          activeEmbeddingGenerationId: doc.activeEmbeddingGenerationId ?? null,
          legacyEmbeddingConnectionId: doc.legacyEmbeddingConnectionId ?? null,
        }
      : defaults(),
    connections: (doc?.connections ?? []).map(
      ({
        id,
        name,
        provider,
        model,
        keyHint,
        checkedAt,
        checkedOk,
        checkCode,
      }) => ({
        id,
        name,
        provider,
        model,
        keyHint,
        checkedAt,
        checkedOk,
        checkCode,
      })
    ),
    audit: (doc?.audit ?? []).slice().reverse(),
    suggestedModels: [...providerModels.gemini],
    providerModels,
    activeEmbeddingGenerationId: doc?.activeEmbeddingGenerationId ?? null,
    legacyEmbeddingConnectionId: doc?.legacyEmbeddingConnectionId ?? null,
  };
}
export async function clearAiSettingsAudit(revision: number) {
  // Do not bootstrap settings, decrypt credentials or rewrite operating state.
  // The revision fences concurrent configuration/audit writes.
  const result = await AiSettings.updateOne(
    { _id: 'global', revision },
    { $set: { audit: [] }, $inc: { revision: 1 } },
    { runValidators: true }
  );
  if (!result.matchedCount)
    throw createError(409, 'AI configuration changed. Reload before saving.');
  return readAiSettings();
}
export async function editable(revision: number) {
  if (!credentialsReady())
    throw createError(503, 'AI configuration encryption is not configured');
  let doc = await load();
  if (!doc) {
    const key = process.env['GEMINI_API_KEY']?.trim();
    const config = defaults();
    const id = randomUUID();
    const connections = key
      ? [
          {
            id,
            name: 'Environment bootstrap',
            provider: 'gemini',
            model: environmentAiConfig().model,
            encryptedKey: encryptCredential(key, id),
            keyHint: key.slice(-4),
            checkedOk: false,
          },
        ]
      : [];
    try {
      await AiSettings.updateOne(
        { _id: 'global' },
        {
          $setOnInsert: {
            ...config,
            enabled: config.enabled && !!key,
            activeConnectionId: key ? id : null,
            legacyEmbeddingConnectionId: key ? id : null,
            connections,
            revision: 0,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000
      ))
        throw error;
    }
    doc = await load();
  }
  if (!doc || doc.revision !== revision)
    throw createError(409, 'AI configuration changed. Reload before saving.');
  return doc;
}
export async function commit(
  doc: Settings,
  actor: string,
  action: string,
  connectionId?: string
) {
  const audit = [
    ...doc.audit,
    {
      action,
      actor,
      at: new Date(),
      ...(connectionId ? { connectionId } : {}),
    },
  ].slice(-100);
  const result = await AiSettings.updateOne(
    { _id: 'global', revision: doc.revision },
    {
      $set: {
        enabled: doc.enabled,
        semanticEnabled: doc.semanticEnabled,
        indexingEnabled: doc.indexingEnabled,
        riskEnabled: doc.riskEnabled,
        dailyCalls: doc.dailyCalls,
        activeConnectionId: doc.activeConnectionId,
        activeEmbeddingGenerationId: doc.activeEmbeddingGenerationId ?? null,
        legacyEmbeddingConnectionId: doc.legacyEmbeddingConnectionId ?? null,
        connections: doc.connections,
        audit,
      },
      $inc: { revision: 1 },
    },
    { runValidators: true }
  );
  if (!result.modifiedCount)
    throw createError(409, 'AI configuration changed. Reload before saving.');
  return readAiSettings();
}
export async function saveConnection(
  input: z.infer<typeof connectionInput>,
  actor: string,
  id?: string
) {
  const doc = await editable(input.revision);
  const connection = id
    ? doc.connections.find((item) => item.id === id)
    : undefined;
  if (id && !connection) throw createError(404, 'AI connection not found');
  if (id === doc.activeConnectionId)
    throw createError(
      409,
      'Deactivate this connection before changing its model or key.'
    );
  if (connection) {
    const changed =
      connection.model !== input.model ||
      connection.provider !== input.provider ||
      !!input.apiKey;
    if (
      changed &&
      (await AiEmbeddingGeneration.exists({ connectionId: connection.id }))
    )
      throw createError(
        409,
        'This connection is referenced by an embedding version. Create a new connection or remove unused versions first.'
      );
    if (
      doc.legacyEmbeddingConnectionId === connection.id &&
      input.provider !== 'gemini'
    ) {
      if (
        !doc.activeEmbeddingGenerationId &&
        (doc.semanticEnabled || doc.indexingEnabled)
      )
        throw createError(
          409,
          'This connection supplies legacy embeddings. Switch to an embedding version first.'
        );
      doc.legacyEmbeddingConnectionId = null;
    }
    if (connection.provider !== input.provider && !input.apiKey)
      throw createError(
        400,
        'A new API key is required when changing providers'
      );
    connection.provider = input.provider;
    connection.name = input.name;
    connection.model = input.model;
    if (input.apiKey) {
      connection.encryptedKey = encryptCredential(input.apiKey, connection.id);
      connection.keyHint = input.apiKey.slice(-4);
    }
    if (changed) {
      connection.checkedOk = false;
      delete connection.checkedAt;
      delete connection.checkCode;
    }
  } else {
    if (!input.apiKey)
      throw createError(400, 'An API key is required for a new connection');
    if (doc.connections.length >= 20)
      throw createError(400, 'Maximum 20 AI connections');
    const nextId = randomUUID();
    doc.connections.push({
      id: nextId,
      name: input.name,
      provider: input.provider,
      model: input.model,
      encryptedKey: encryptCredential(input.apiKey, nextId),
      keyHint: input.apiKey.slice(-4),
      checkedOk: false,
    });
  }
  return commit(
    doc,
    actor,
    id ? 'connection.updated' : 'connection.created',
    id ?? doc.connections.at(-1)!.id
  );
}
export async function deleteConnection(
  id: string,
  revision: number,
  actor: string
) {
  const doc = await editable(revision);
  if (doc.activeConnectionId === id)
    throw createError(409, 'Deactivate this connection before deleting it.');
  if (await AiEmbeddingGeneration.exists({ connectionId: id }))
    throw createError(
      409,
      'Remove embedding versions referencing this connection before deleting it.'
    );
  if (doc.legacyEmbeddingConnectionId === id) {
    if (
      !doc.activeEmbeddingGenerationId &&
      (doc.semanticEnabled || doc.indexingEnabled)
    )
      throw createError(
        409,
        'This connection supplies legacy embeddings. Switch versions or disable vector features first.'
      );
    doc.legacyEmbeddingConnectionId = null;
  }
  if (!doc.connections.some((item) => item.id === id))
    throw createError(404, 'AI connection not found');
  doc.connections = doc.connections.filter((item) => item.id !== id);
  return commit(doc, actor, 'connection.deleted', id);
}
export async function initializeAiSettings(revision: number, actor: string) {
  const doc = await editable(revision);
  return commit(doc, actor, 'settings.initialized');
}
export async function saveAiSettings(
  input: z.infer<typeof settingsInput>,
  actor: string
) {
  if (input.indexingEnabled && input.dailyCalls < 4)
    throw createError(
      400,
      'Automatic indexing requires a daily call limit of at least 4'
    );
  const doc = await editable(input.revision);
  if (!doc.legacyEmbeddingConnectionId && !doc.activeEmbeddingGenerationId) {
    const previous = doc.connections.find(
      (item) => item.id === doc.activeConnectionId
    );
    if (previous?.provider === 'gemini')
      doc.legacyEmbeddingConnectionId = previous.id;
  }
  const selected = doc.connections.find(
    (item) => item.id === input.activeConnectionId
  );
  if (input.activeConnectionId && !selected)
    throw createError(400, 'AI connection not found');
  if (input.enabled && !selected)
    throw createError(400, 'Select an AI connection before enabling AI');
  if (
    selected &&
    (doc.activeConnectionId !== selected.id ||
      (!doc.enabled && input.enabled)) &&
    !selected.checkedOk
  )
    throw createError(
      400,
      'Test this connection successfully before activating it'
    );
  if (
    (input.semanticEnabled &&
      !doc.activeEmbeddingGenerationId &&
      !environmentAiConfig().vectorIndex) ||
    (input.indexingEnabled &&
      !environmentAiConfig().vectorIndex &&
      !(await AiEmbeddingGeneration.exists({})))
  )
    throw createError(
      400,
      'Configure AI_VECTOR_INDEX on the server before enabling vector features'
    );
  const legacyId =
    doc.legacyEmbeddingConnectionId ??
    (selected?.provider === 'gemini' ? selected.id : null);
  if (
    input.semanticEnabled &&
    !doc.activeEmbeddingGenerationId &&
    !doc.connections.some(
      (item) => item.id === legacyId && item.provider === 'gemini'
    )
  )
    throw createError(
      400,
      'Choose an embedding version before enabling semantic retrieval with this provider.'
    );
  if (
    !doc.legacyEmbeddingConnectionId &&
    selected?.provider === 'gemini' &&
    !doc.activeEmbeddingGenerationId
  )
    doc.legacyEmbeddingConnectionId = selected.id;
  Object.assign(doc, input);
  return commit(doc, actor, 'settings.updated');
}
export async function testConnection(
  id: string,
  revision: number,
  actor: string,
  signal: AbortSignal
) {
  const doc = await editable(revision);
  const connection = doc.connections.find((item) => item.id === id);
  if (!connection?.encryptedKey)
    throw createError(404, 'AI connection not found');
  const base = environmentAiConfig();
  const config = {
    ...base,
    source: 'database' as const,
    revision: doc.revision,
    model: connection.model,
    provider: connection.provider,
    enabled: true,
    dailyCalls: doc.dailyCalls,
    chatTokens: Math.max(1024, Math.min(base.chatTokens, 2048)),
  };
  let ok = false,
    code = 'AI_PROVIDER_ERROR';
  try {
    await withAiRuntime(
      {
        config,
        apiKey: decryptCredential(connection.encryptedKey, connection.id),
      },
      async () => {
        await aiProvider.interpretQuery(
          'Find headphones under 500000 VND',
          signal
        );
        let answer = '';
        for await (const delta of aiProvider.answerStream(
          'Xin chào',
          JSON.stringify({ products: [], sources: [] }),
          [],
          signal
        ))
          answer += delta;
        if (!answer.trim()) throw new Error('Empty response');
      }
    );
    ok = true;
    code = 'OK';
  } catch (error) {
    signal.throwIfAborted();
    code = classifyAiFailure(error, 'generation').code;
  }
  connection.checkedOk = ok;
  connection.checkedAt = new Date();
  connection.checkCode = code;
  return commit(doc, actor, 'connection.tested', id);
}
