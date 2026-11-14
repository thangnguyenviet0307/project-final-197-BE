import createError from 'http-errors';
import type { z } from 'zod';
import { AiSettings } from '../../models/ai/ai-settings.model.js';
import { AiEmbeddingGeneration } from '../../models/ai/ai-embedding.model.js';
import { AiProviderState } from '../../models/ai/ai-provider-state.model.js';
import { settingsInput } from '../../validations/ai/ai-settings.validation.js';
import { environmentAiConfig, withAiRuntime } from './config.js';
import { aiProvider } from './providers/provider.js';
import { aiError, classifyAiFailure } from './failures.js';
import {
  environmentConnections,
  environmentRoutingInventory,
  ENV_EMBEDDING_ID,
} from './provider-environment.js';
const defaults = () => {
  const c = environmentAiConfig();
  return {
    enabled: c.enabled,
    semanticEnabled: c.semanticEnabled,
    indexingEnabled: c.indexingEnabled,
    riskEnabled: c.riskEnabled,
  };
};
export async function readAiSettings() {
  const [doc, hasVersions, states] = await Promise.all([
    AiSettings.findById('global').maxTimeMS(5000).lean(),
    AiEmbeddingGeneration.exists({}),
    AiProviderState.find({ until: { $gt: new Date() } })
      .maxTimeMS(5000)
      .lean(),
  ]);
  const pool = environmentConnections();
  const generation = doc?.activeEmbeddingGenerationId
    ? await AiEmbeddingGeneration.findById(
        doc.activeEmbeddingGenerationId
      ).lean()
    : null;
  return {
    source: doc ? 'database' : 'environment',
    credentialSource: 'environment',
    automaticRouting: true,
    revision: doc?.revision ?? 0,
    encryptionReady: true, // Compatibility field: web operations no longer require encryption.
    vectorReady: !!environmentAiConfig().vectorIndex || !!hasVersions,
    semanticReady: generation
      ? generation.provider === 'gemini' && generation.state === 'ready'
      : !!environmentAiConfig().vectorIndex,
    emergencyDisabled: process.env['AI_FORCE_DISABLED'] === 'true',
    settings: doc
      ? {
          enabled: doc.enabled,
          semanticEnabled: doc.semanticEnabled,
          indexingEnabled: doc.indexingEnabled,
          riskEnabled: doc.riskEnabled,
        }
      : defaults(),
    routing: environmentRoutingInventory().map((item) => {
      const c = pool.find(
        (c) => c.provider === item.provider && c.model === item.model
      );
      return {
        ...item,
        retryAt: c
          ? (states
              .filter(
                (s) =>
                  s._id === `account:${c.account}` ||
                  s._id === `model:${c.account}:${c.model}`
              )
              .sort((a, b) => b.until.getTime() - a.until.getTime())[0]
              ?.until ?? null)
          : null,
      };
    }),
    connections: process.env['GEMINI_API_KEY']?.trim()
      ? [
          {
            id: ENV_EMBEDDING_ID,
            name: 'Gemini (.env)',
            provider: 'gemini',
            model: environmentAiConfig().embeddingModel,
            checkedOk: true,
            keyHint: '',
          },
        ]
      : [],
    audit: (doc?.audit ?? []).slice().reverse(),
    activeEmbeddingGenerationId: doc?.activeEmbeddingGenerationId ?? null,
  };
}
export async function editable(revision: number) {
  let doc = await AiSettings.findById('global').maxTimeMS(5000).lean();
  if (!doc) {
    try {
      await AiSettings.updateOne(
        { _id: 'global' },
        { $setOnInsert: { ...defaults(), revision: 0 } },
        { upsert: true }
      );
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 11000))
        throw e;
    }
    doc = await AiSettings.findById('global').maxTimeMS(5000).lean();
  }
  if (!doc || doc.revision !== revision)
    throw createError(409, 'AI configuration changed. Reload before saving.');
  return doc;
}
export async function initializeAiSettings(revision: number, actor: string) {
  await editable(revision);
  // Initialization never imports credentials or resets existing operating flags.
  void actor;
  return readAiSettings();
}
export async function clearAiSettingsAudit(revision: number) {
  const result = await AiSettings.updateOne(
    { _id: 'global', revision },
    { $set: { audit: [] }, $inc: { revision: 1 } }
  );
  if (
    !result.modifiedCount &&
    (revision !== 0 || (await AiSettings.exists({ _id: 'global' })))
  )
    throw createError(
      409,
      'Cấu hình AI đã thay đổi. Hãy tải lại và xác nhận xóa lịch sử lần nữa.'
    );
  return readAiSettings();
}
export async function activateAi(
  revision: number,
  actor: string,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  if (process.env['AI_FORCE_DISABLED'] === 'true')
    throw createError(
      409,
      'AI đang bị tắt khẩn cấp trên máy chủ. Hãy đặt AI_FORCE_DISABLED=false và khởi động lại backend.'
    );
  const connections = environmentConnections();
  if (!connections.length)
    throw createError(
      400,
      'Chưa có kết nối AI hợp lệ. Hãy cấu hình khóa API trên máy chủ.'
    );
  const current = await AiSettings.findById('global').maxTimeMS(5000).lean();
  if ((current?.revision ?? 0) !== revision)
    throw createError(
      409,
      'Cấu hình AI đã thay đổi. Hãy tải lại trang trước khi kích hoạt.'
    );
  try {
    await withAiRuntime(
      {
        config: { ...environmentAiConfig(), enabled: true },
        apiKey: connections[0]!.apiKey,
        embeddingApiKey: process.env['GEMINI_API_KEY']?.trim() ?? '',
        connections,
        cloudflareAccountId: process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '',
      },
      async () => {
        await aiProvider.interpretQuery('Tìm sản phẩm trong cửa hàng', signal);
        let answer = '';
        for await (const text of aiProvider.answerStream(
          'Xin chào',
          JSON.stringify({ products: [], sources: [] }),
          [],
          signal
        )) {
          answer += text;
          if (answer.length > 16000) throw aiError('AI_OUTPUT_LIMIT');
        }
        if (!answer.trim()) throw aiError('AI_INVALID_RESPONSE');
      }
    );
  } catch (error) {
    signal.throwIfAborted();
    const failure = classifyAiFailure(error, 'generation');
    throw aiError(failure.code, failure.code === 'AI_RATE_LIMITED' ? 429 : 503);
  }
  signal.throwIfAborted();
  if (process.env['AI_FORCE_DISABLED'] === 'true')
    throw createError(409, 'AI đang bị tắt khẩn cấp trên máy chủ.');
  await editable(revision);
  signal.throwIfAborted();
  const result = await AiSettings.updateOne(
    { _id: 'global', revision },
    {
      $set: { enabled: true },
      $inc: { revision: 1 },
      $push: {
        audit: {
          $each: [{ action: 'settings.activated', actor, at: new Date() }],
          $slice: -100,
        },
      },
    }
  );
  if (!result.modifiedCount)
    throw createError(
      409,
      'Cấu hình AI đã thay đổi trong lúc kiểm tra. Hãy tải lại trang.'
    );
  return readAiSettings();
}
export async function saveAiSettings(
  input: z.infer<typeof settingsInput>,
  actor: string
) {
  const doc = await editable(input.revision);
  if (input.enabled && !environmentConnections().length)
    throw createError(
      400,
      'Configure AI providers in the server environment first'
    );
  if (input.indexingEnabled && !process.env['GEMINI_API_KEY']?.trim())
    throw createError(400, 'Indexing requires a Gemini environment key');
  if (input.semanticEnabled) {
    const g = doc.activeEmbeddingGenerationId
      ? await AiEmbeddingGeneration.findOne({
          _id: doc.activeEmbeddingGenerationId,
          provider: 'gemini',
          state: 'ready',
        }).lean()
      : null;
    if (
      !process.env['GEMINI_API_KEY']?.trim() ||
      (!g && !environmentAiConfig().vectorIndex)
    )
      throw createError(
        400,
        'Chưa có dữ liệu tìm kiếm ngữ nghĩa sẵn sàng. Hãy tạo phiên bản kiến thức Gemini, chờ đồng bộ hoàn tất và kích hoạt phiên bản đó; hoặc tắt Tìm kiếm ngữ nghĩa để lưu và sử dụng chatbot trước.'
      );
  }
  const { revision, ...flags } = input;
  const result = await AiSettings.updateOne(
    { _id: 'global', revision },
    {
      $set: flags,
      $inc: { revision: 1 },
      $push: {
        audit: {
          $each: [{ action: 'settings.updated', actor, at: new Date() }],
          $slice: -100,
        },
      },
    },
    { runValidators: true }
  );
  if (!result.modifiedCount)
    throw createError(409, 'AI configuration changed. Reload before saving.');
  return readAiSettings();
}
