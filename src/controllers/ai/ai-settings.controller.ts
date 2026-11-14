import type { RequestHandler } from 'express';
import createError from 'http-errors';
import { httpAiTask } from '../../services/ai/request-lifecycle.js';
import { wakeIndexWorker } from '../../services/ai/index-worker-control.js';
import type { AuthenticatedRequest } from '../../middlewares/auth/auth.middleware.js';
import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import { sendResponse } from '../../helpers/response.helper.js';
import * as settings from '../../services/ai/settings.service.js';
import {
  settingsInput,
  settingsRevision,
  activationInput,
} from '../../validations/ai/ai-settings.validation.js';
const actor = (req: AuthenticatedRequest) => req.user!.id;
export const clearAudit: RequestHandler = asyncHandler(
  async (req: AuthenticatedRequest, res) => {
    if (req.user?.role !== 'super_admin')
      throw createError(403, 'Chỉ Super Admin được xóa lịch sử cấu hình AI.');
    const input = activationInput.parse(req.body);
    res.setHeader('Cache-Control', 'no-store');
    sendResponse(res, 200, {
      data: await settings.clearAiSettingsAudit(input.revision),
    });
  }
);
export const activate: RequestHandler = asyncHandler(
  async (req: AuthenticatedRequest, res) => {
    if (req.user?.role !== 'super_admin')
      throw createError(
        403,
        'Chỉ Super Admin được kích hoạt hoặc kết nối lại AI.'
      );
    const input = activationInput.parse(req.body);
    res.setHeader('Cache-Control', 'no-store');
    const data = await httpAiTask(req, res, (signal) =>
      settings.activateAi(input.revision, actor(req), signal)
    );
    sendResponse(res, 200, { data });
    wakeIndexWorker();
  }
);
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
export const save: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await settings.saveAiSettings(
      settingsInput.parse(req.body),
      actor(req)
    ),
  });
  wakeIndexWorker();
});
