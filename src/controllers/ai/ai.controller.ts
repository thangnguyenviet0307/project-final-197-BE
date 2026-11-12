import type { RequestHandler } from 'express';
import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import { sendResponse } from '../../helpers/response.helper.js';
import type { AiOwner } from '../../types/ai/ai.types.js';
import * as conversations from '../../services/ai/conversation.service.js';
import {
  searchProducts,
  recommendProducts,
} from '../../services/ai/retrieval.service.js';
import {
  aiSearchSchema,
  historyQuery,
  cancelTurnSchema,
} from '../../validations/ai/ai.validation.js';
import {
  AiChunk,
  AiTurn,
  AiConversation,
  AiCounter,
  AiIndexJob,
  AiRiskEvent,
} from '../../models/ai/ai.model.js';
import { aiConfig } from '../../services/ai/config.js';
import { httpAiTask } from '../../services/ai/request-lifecycle.js';
const owner = (locals: Record<string, unknown>) => locals['aiOwner'] as AiOwner;
export const cancel: RequestHandler = asyncHandler(async (req, res) => {
  const input = cancelTurnSchema.parse(req.body);
  sendResponse(res, 200, {
    data: await conversations.cancelTurn(
      String(req.params['id']),
      owner(res.locals),
      input.requestId,
      input.content
    ),
  });
});
export const create: RequestHandler = asyncHandler(async (_req, res) => {
  const doc = await conversations.createConversation(owner(res.locals));
  sendResponse(res, 201, { data: { id: String(doc._id), status: doc.status } });
});
export const list: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await conversations.listConversations(
      owner(res.locals),
      historyQuery.parse(req.query).page
    ),
  });
});
export const history: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await conversations.history(
      String(req.params['id']),
      owner(res.locals),
      historyQuery.parse(req.query).page
    ),
  });
});
export const end: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await conversations.endConversation(
      String(req.params['id']),
      owner(res.locals)
    ),
  });
});
export const ticket: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 201, {
    data: { ticket: await conversations.socketTicket(owner(res.locals)) },
  });
});
export const search: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await httpAiTask(req, res, (signal) =>
      searchProducts(aiSearchSchema.parse(req.query), undefined, true, signal)
    ),
  });
});
export const recommendations: RequestHandler = asyncHandler(
  async (req, res) => {
    sendResponse(res, 200, {
      data: await httpAiTask(req, res, (signal) =>
        recommendProducts(String(req.params['slug']), signal)
      ),
    });
  }
);
export const status: RequestHandler = asyncHandler(async (_req, res) => {
  const [conversations, chunks, usage, risks, index, failures] =
    await Promise.all([
      AiConversation.countDocuments({ expiresAt: { $gt: new Date() } }),
      AiChunk.countDocuments(),
      AiCounter.find({
        _id: /^provider-global:/,
        expiresAt: { $gt: new Date() },
      })
        .select('count expiresAt')
        .lean(),
      AiRiskEvent.find({ expiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('-actorHash')
        .lean(),
      AiIndexJob.findById('sync').lean(),
      AiTurn.find({
        status: 'failed',
        error: { $exists: true },
        expiresAt: { $gt: new Date() },
      })
        .sort({ updatedAt: -1 })
        .limit(20)
        .select('requestId error updatedAt -_id')
        .lean(),
    ]);
  sendResponse(res, 200, {
    data: {
      config: aiConfig(),
      conversations,
      chunks,
      usage,
      risks,
      index,
      failures,
    },
  });
});
export const reindex: RequestHandler = asyncHandler(async (_req, res) => {
  await AiIndexJob.updateOne(
    { _id: 'sync' },
    {
      $set: { nextRunAt: new Date(), requestedAt: new Date() },
      $setOnInsert: { state: 'queued' },
    },
    { upsert: true }
  );
  sendResponse(res, 202, { message: 'Đã xếp lịch đồng bộ kiến thức.' });
});
