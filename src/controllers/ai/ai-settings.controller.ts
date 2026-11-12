import type { RequestHandler } from 'express';
import { wakeIndexWorker } from '../../services/ai/index-worker-control.js';
import type { AuthenticatedRequest } from '../../middlewares/auth/auth.middleware.js';
import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import { sendResponse } from '../../helpers/response.helper.js';
import * as settings from '../../services/ai/settings.service.js';
import {
  connectionInput,
  connectionParams,
  settingsInput,
  settingsRevision,
} from '../../validations/ai/ai-settings.validation.js';
import { httpAiTask } from '../../services/ai/request-lifecycle.js';
const actor = (req: AuthenticatedRequest) => req.user!.id;
export const initialize: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await settings.initializeAiSettings(
      settingsRevision.parse(req.body).revision,
      actor(req)
    ),
  });
});
export const read: RequestHandler = asyncHandler(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendResponse(res, 200, { data: await settings.readAiSettings() });
});
export const create: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 201, {
    data: await settings.saveConnection(
      connectionInput.parse(req.body),
      actor(req)
    ),
  });
});
export const update: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await settings.saveConnection(
      connectionInput.parse(req.body),
      actor(req),
      connectionParams.parse(req.params).id
    ),
  });
});
export const remove: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await settings.deleteConnection(
      connectionParams.parse(req.params).id,
      settingsRevision.parse(req.body).revision,
      actor(req)
    ),
  });
});
export const save: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await settings.saveAiSettings(
      settingsInput.parse(req.body),
      actor(req)
    ),
  });
  wakeIndexWorker();
});
export const test: RequestHandler = asyncHandler(async (req, res) => {
  const id = connectionParams.parse(req.params).id;
  const { revision } = settingsRevision.parse(req.body);
  sendResponse(res, 200, {
    data: await httpAiTask(req, res, (signal) =>
      settings.testConnection(id, revision, actor(req), signal)
    ),
  });
});
