import {
  embeddingDefinition,
  embeddingKey,
  embeddingModels,
  embeddingConnectionIds,
  validEmbedding,
} from './embedding-catalog.js';
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
    supportedModels: embeddingModels.map((item) => ({
      ...item,
      available: !!embeddingKey(item.provider),
    })),
  };
}
export async function createEmbeddingVersion(
  input: z.infer<typeof embeddingVersionInput>,
  actor: string,
  auto = false,
  parentId: string | null = null
) {
  const doc = await editable(input.revision);
  const model = input.model;
  const definition = embeddingDefinition(model);
  if (
    !definition ||
    !validEmbedding(definition.provider, model, input.dimensions)
  )
    throw createError(
      400,
      'Model embedding, nhà cung cấp và số chiều vector không tương thích.'
    );
  const provider = definition.provider;
  if (input.startSync && !doc.enabled)
    throw createError(
      409,
      'Vui lòng bật trợ lý AI trước khi bắt đầu đồng bộ kiến thức.'
    );
  if (!embeddingKey(provider))
    throw createError(
      400,
      'Vui lòng cấu hình khóa API của nhà cung cấp embedding đã chọn trên máy chủ.'
    );
  if (
    input.connectionId !== embeddingConnectionIds[provider] &&
    !doc.connections.some(
      (c) => c.id === input.connectionId && c.provider === provider
    )
  )
    throw createError(
      400,
      'Kết nối embedding không thuộc nhà cung cấp của model đã chọn.'
    );
  const id = randomUUID();
  await mongoose.connection.transaction(async (session) => {
    if (
      await AiEmbeddingGeneration.exists({
        provider,
        model,
        dimensions: input.dimensions,
        state: { $in: ['queued', 'building', 'verifying'] },
        indexName: input.engine === 'exact' ? /^ai_exact_/ : /^ai_vectors_/,
      }).session(session)
    )
      throw createError(
        409,
        'Đã có phiên bản tương ứng đang chờ hoặc đang đồng bộ. Hãy chờ hoàn tất hoặc hủy phiên bản đó trước.'
      );
    if ((await AiEmbeddingGeneration.countDocuments().session(session)) >= 20)
      throw createError(
        409,
        'Chỉ được lưu tối đa 20 phiên bản embedding. Vui lòng xóa phiên bản không còn sử dụng trước.'
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
      throw createError(
        409,
        'Cấu hình AI đã thay đổi. Vui lòng tải lại trang trước khi lưu.'
      );
    await AiEmbeddingGeneration.create(
      [
        {
          _id: id,
          connectionId: input.connectionId,
          provider,
          model,
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
    AiSettings.findById('global').lean(),
  ]);
  const key = generation ? embeddingKey(generation.provider) : '';
  if (
    !generation ||
    !validEmbedding(
      generation.provider,
      generation.model,
      generation.dimensions
    ) ||
    !key
  )
    throw createError(
      409,
      'Chưa có kết nối embedding hợp lệ. Vui lòng kiểm tra model và khóa API của nhà cung cấp trên máy chủ.'
    );
  return {
    config: {
      ...environmentAiConfig(),
      enabled: true,
      source: 'database',
      revision: settings?.revision ?? 0,
      embeddingProvider: generation.provider as
        'gemini' | 'cloudflare' | 'openrouter',
      embeddingModel: generation.model,
      embeddingDimensions: generation.dimensions,
      embeddingGeneration: generation._id,
      vectorIndex: generation.indexName,
    },
    apiKey: key,
    cloudflareAccountId: process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '',
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
    throw createError(409, 'Phiên bản embedding chưa sẵn sàng để sử dụng.');
  if (generation) {
    if (
      !validEmbedding(
        generation.provider,
        generation.model,
        generation.dimensions
      ) ||
      !embeddingKey(generation.provider)
    )
      throw createError(
        409,
        'Chưa có kết nối embedding hợp lệ. Vui lòng kiểm tra model và khóa API của nhà cung cấp trên máy chủ.'
      );
    let indexId: string;
    try {
      indexId = await vectorInfrastructure.ensure(generation);
    } catch {
      throw createError(
        409,
        'Chỉ mục vector chưa sẵn sàng hoặc có cấu hình không tương thích.'
      );
    }
    if (indexId !== generation.indexId)
      throw createError(
        409,
        'Chỉ mục vector đã thay đổi. Vui lòng tạo lại dữ liệu của phiên bản trước khi kích hoạt.'
      );
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
        throw createError(
          409,
          'Phiên bản embedding đã thay đổi. Vui lòng tải lại trang và thử lại.'
        );
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
        'Cấu hình AI đã thay đổi. Vui lòng tải lại trang trước khi chuyển phiên bản.'
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
      'Vui lòng ngừng sử dụng hoặc chuyển sang phiên bản khác trước khi thực hiện thao tác này.'
    );
  await mongoose.connection.transaction(async (session) => {
    const generation = await AiEmbeddingGeneration.findById(id)
      .session(session)
      .lean();
    if (!generation)
      throw createError(404, 'Không tìm thấy phiên bản embedding.');
    if (
      action === 'retry' &&
      (!validEmbedding(
        generation.provider,
        generation.model,
        generation.dimensions
      ) ||
        !embeddingKey(generation.provider))
    )
      throw createError(
        409,
        'Chưa có kết nối embedding hợp lệ. Vui lòng kiểm tra model và khóa API của nhà cung cấp trên máy chủ.'
      );
    if (
      action === 'retry' &&
      !['failed', 'cancelled', 'ready'].includes(generation.state)
    )
      throw createError(
        409,
        'Chỉ có thể thử lại phiên bản đã hoàn tất, thất bại hoặc bị hủy.'
      );
    if (
      action === 'cancel' &&
      !['queued', 'building', 'verifying'].includes(generation.state)
    )
      throw createError(409, 'Phiên bản này không có tác vụ đang chạy để hủy.');
    if (
      action === 'delete' &&
      ['queued', 'building', 'verifying'].includes(generation.state)
    )
      throw createError(
        409,
        'Vui lòng hủy tác vụ đang chờ hoặc đang đồng bộ trước khi xóa phiên bản.'
      );
    if (
      action === 'delete' &&
      generation.lastDeactivatedAt &&
      generation.lastDeactivatedAt.getTime() > Date.now() - 5 * 60000
    )
      throw createError(
        409,
        'Vui lòng đợi ít nhất 5 phút sau khi ngừng sử dụng phiên bản trước khi xóa.'
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
      throw createError(
        409,
        'Cấu hình AI đã thay đổi. Vui lòng tải lại trang trước khi lưu.'
      );
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
