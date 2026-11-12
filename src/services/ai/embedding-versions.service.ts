import { randomUUID } from 'node:crypto';
import { indexWorkerStatus } from './index-worker-control.js';
import mongoose from 'mongoose';
import createError from 'http-errors';
import type { z } from 'zod';
import {
  AiEmbeddingGeneration,
  AiEmbeddingChunk,
} from '../../models/ai/ai-embedding.model.js';
import { AiSettings } from '../../models/ai/ai-settings.model.js';
import { embeddingVersionInput } from '../../validations/ai/ai-embedding.validation.js';
import { editable } from './settings.service.js';
import {
  vectorInfrastructure,
  vectorDefinition,
} from './vector-infrastructure.js';
import { decryptCredential } from './credentials.js';
import { environmentAiConfig, type AiRuntime } from './config.js';

export async function readEmbeddingVersions() {
  const [settings, versions] = await Promise.all([
    AiSettings.findById('global').lean(),
    AiEmbeddingGeneration.find().sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  return {
    revision: settings?.revision ?? 0,
    activeId: settings?.activeEmbeddingGenerationId ?? null,
    worker: {
      ...indexWorkerStatus(),
      enabled: !!settings?.enabled,
      indexingEnabled: !!settings?.indexingEnabled,
      emergencyDisabled: process.env['AI_FORCE_DISABLED'] === 'true',
    },
    versions: versions.map(
      ({ leaseId: _lease, leaseUntil: _until, ...item }) => ({
        ...item,
        indexDefinition: vectorDefinition(item.dimensions),
      })
    ),
    collection: 'ai_embedding_chunks',
  };
}
export async function createEmbeddingVersion(
  input: z.infer<typeof embeddingVersionInput>,
  actor: string,
  auto = false,
  parentId: string | null = null
) {
  const doc = await editable(input.revision);
  if (input.startSync && doc.dailyCalls < 4)
    throw createError(
      400,
      'Automatic indexing requires a daily call limit of at least 4'
    );
  if (input.startSync && !doc.enabled)
    throw createError(
      409,
      'Enable the AI assistant before starting synchronization'
    );
  const connection = doc.connections.find(
    (item) => item.id === input.connectionId
  );
  if (!connection || !connection.checkedOk)
    throw createError(400, 'Choose a successfully tested connection');
  const provider = input.model.startsWith('gemini-') ? 'gemini' : 'openai';
  if (connection.provider !== provider)
    throw createError(
      400,
      'Embedding model and connection provider do not match'
    );
  const id = randomUUID();
  await mongoose.connection.transaction(async (session) => {
    if ((await AiEmbeddingGeneration.countDocuments().session(session)) >= 20)
      throw createError(
        409,
        'Maximum 20 embedding versions. Delete unused versions first.'
      );
    const lock = await AiSettings.updateOne(
      { _id: 'global', revision: input.revision },
      {
        $inc: { revision: 1 },
        ...(input.startSync ? { $set: { indexingEnabled: true } } : {}),
        $push: {
          audit: {
            $each: [
              {
                action: 'embedding.created',
                actor,
                at: new Date(),
                connectionId: input.connectionId,
              },
            ],
            $slice: -100,
          },
        },
      },
      { session }
    );
    if (!lock.modifiedCount)
      throw createError(409, 'AI configuration changed. Reload before saving.');
    await AiEmbeddingGeneration.create(
      [
        {
          _id: id,
          connectionId: input.connectionId,
          provider,
          model: input.model,
          dimensions: input.dimensions,
          indexName:
            (input.engine === 'exact' ? 'ai_exact_' : 'ai_vectors_') +
            id.replaceAll('-', ''),
          createdBy: actor,
          autoActivate: auto,
          parentId,
          parentEpoch: doc.embeddingEpoch ?? 0,
        },
      ],
      { session }
    );
  });
  return readEmbeddingVersions();
}
export async function generationRuntime(id: string): Promise<AiRuntime> {
  const [generation, settings] = await Promise.all([
    AiEmbeddingGeneration.findById(id).lean(),
    AiSettings.findById('global').select('+connections.encryptedKey').lean(),
  ]);
  const connection = settings?.connections.find(
    (item) => item.id === generation?.connectionId
  );
  if (
    !generation ||
    !connection?.encryptedKey ||
    connection.provider !== generation.provider
  )
    throw createError(409, 'Embedding connection is unavailable');
  const key = decryptCredential(connection.encryptedKey, connection.id);
  return {
    config: {
      ...environmentAiConfig(),
      enabled: true,
      provider: connection.provider,
      model: connection.model,
      source: 'database',
      revision: settings!.revision,
      dailyCalls: settings!.dailyCalls,
      embeddingProvider: generation.provider,
      embeddingModel: generation.model,
      embeddingDimensions: generation.dimensions,
      embeddingGeneration: generation._id,
      vectorIndex: generation.indexName,
    },
    apiKey: key,
    embeddingApiKey: key,
  };
}
export async function activateEmbeddingVersion(
  id: string | null,
  revision: number,
  actor: string,
  expectedParent?: string | null,
  expectedEpoch?: number
) {
  const doc = await editable(revision);
  if (
    expectedParent !== undefined &&
    (doc.activeEmbeddingGenerationId !== expectedParent ||
      (expectedEpoch !== undefined &&
        (doc.embeddingEpoch ?? 0) !== expectedEpoch))
  )
    return readEmbeddingVersions();
  const generation = id
    ? await AiEmbeddingGeneration.findOne({ _id: id, state: 'ready' }).lean()
    : null;
  if (id && !generation)
    throw createError(409, 'Embedding version is not ready');
  if (generation) {
    let indexId: string;
    try {
      indexId = await vectorInfrastructure.ensure(generation);
    } catch {
      throw createError(
        409,
        'Vector index is not ready or has an incompatible definition'
      );
    }
    if (indexId !== generation.indexId)
      throw createError(
        409,
        'The physical vector index changed. Rebuild this version before activation.'
      );
    if (
      !doc.connections.some(
        (item) =>
          item.id === generation.connectionId &&
          item.provider === generation.provider
      )
    )
      throw createError(409, 'Embedding connection is unavailable');
  }
  await mongoose.connection.transaction(async (session) => {
    if (generation) {
      const lock = await AiEmbeddingGeneration.updateOne(
        {
          _id: generation._id,
          state: 'ready',
          revision: generation.revision,
          indexId: generation.indexId ?? null,
        },
        { $inc: { revision: 1 } },
        { session }
      );
      if (!lock.modifiedCount)
        throw createError(409, 'Embedding version changed');
    }
    const result = await AiSettings.updateOne(
      {
        _id: 'global',
        revision,
        activeEmbeddingGenerationId: doc.activeEmbeddingGenerationId ?? null,
      },
      {
        $set: {
          activeEmbeddingGenerationId: id,
          ...(id
            ? { semanticEnabled: true }
            : { semanticEnabled: false, indexingEnabled: false }),
        },
        $inc: { revision: 1, embeddingEpoch: 1 },
        $push: {
          audit: {
            $each: [
              {
                action: id ? 'embedding.activated' : 'embedding.legacy',
                actor,
                at: new Date(),
                connectionId: generation?.connectionId,
              },
            ],
            $slice: -100,
          },
        },
      },
      { session }
    );
    if (!result.modifiedCount)
      throw createError(
        409,
        'AI configuration changed. Reload before switching.'
      );
    if (
      doc.activeEmbeddingGenerationId &&
      doc.activeEmbeddingGenerationId !== id
    )
      await AiEmbeddingGeneration.updateOne(
        { _id: doc.activeEmbeddingGenerationId },
        { $set: { lastDeactivatedAt: new Date() } },
        { session }
      );
  });
  return readEmbeddingVersions();
}
export async function changeEmbeddingVersion(
  id: string,
  revision: number,
  actor: string,
  action: 'retry' | 'cancel' | 'delete'
) {
  const doc = await editable(revision);
  if (doc.activeEmbeddingGenerationId === id)
    throw createError(
      409,
      'Switch away from the active embedding version first'
    );
  await mongoose.connection.transaction(async (session) => {
    const generation = await AiEmbeddingGeneration.findById(id)
      .session(session)
      .lean();
    if (!generation) throw createError(404, 'Embedding version not found');
    if (
      action === 'retry' &&
      !['failed', 'cancelled', 'ready'].includes(generation.state)
    )
      throw createError(409, 'Only terminal versions can be retried');
    if (
      action === 'cancel' &&
      !['queued', 'building', 'verifying'].includes(generation.state)
    )
      throw createError(409, 'This version is not running');
    if (
      action === 'delete' &&
      (['queued', 'building', 'verifying'].includes(generation.state) ||
        (generation.lastDeactivatedAt &&
          generation.lastDeactivatedAt.getTime() > Date.now() - 5 * 60000))
    )
      throw createError(
        409,
        'Cancel pending work, and wait five minutes after deactivation before deletion'
      );
    const lock = await AiSettings.updateOne(
      { _id: 'global', revision },
      {
        $inc: { revision: 1 },
        $push: {
          audit: {
            $each: [
              {
                action: 'embedding.' + action,
                actor,
                at: new Date(),
                connectionId: generation.connectionId,
              },
            ],
            $slice: -100,
          },
        },
      },
      { session }
    );
    if (!lock.modifiedCount)
      throw createError(409, 'AI configuration changed. Reload before saving.');
    if (action === 'delete') {
      await AiEmbeddingGeneration.deleteOne(
        { _id: id, revision: generation.revision },
        { session }
      );
      await AiEmbeddingChunk.deleteMany({ generation: id }, { session });
    } else
      await AiEmbeddingGeneration.updateOne(
        { _id: id, revision: generation.revision },
        {
          $set: {
            state:
              action === 'retry'
                ? generation.state === 'ready'
                  ? 'verifying'
                  : 'queued'
                : 'cancelled',
            leaseId: null,
            leaseUntil: null,
            nextRunAt: new Date(),
            failureCode: null,
          },
          $inc: { revision: 1 },
        },
        { session }
      );
  });
  // Search indexes are not dropped automatically. They may still serve an in-flight
  // request; retained indexes can be removed separately by an infrastructure owner.
  return readEmbeddingVersions();
}
