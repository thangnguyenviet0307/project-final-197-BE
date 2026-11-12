import type { RequestHandler } from 'express';
import { wakeIndexWorker } from '../../services/ai/index-worker-control.js';
import type { AuthenticatedRequest } from '../../middlewares/auth/auth.middleware.js';
import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import { sendResponse } from '../../helpers/response.helper.js';
import { connectionParams } from '../../validations/ai/ai-settings.validation.js';
import {
  embeddingVersionInput,
  embeddingActivationInput,
  embeddingActionInput,
} from '../../validations/ai/ai-embedding.validation.js';
import * as service from '../../services/ai/embedding-versions.service.js';
const actor = (req: AuthenticatedRequest) => req.user!.id;
export const read: RequestHandler = asyncHandler(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendResponse(res, 200, { data: await service.readEmbeddingVersions() });
});
export const create: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 201, {
    data: await service.createEmbeddingVersion(
      embeddingVersionInput.parse(req.body),
      actor(req)
    ),
  });
  wakeIndexWorker();
});
export const activate: RequestHandler = asyncHandler(async (req, res) => {
  const input = embeddingActivationInput.parse(req.body);
  sendResponse(res, 200, {
    data: await service.activateEmbeddingVersion(
      input.generationId,
      input.revision,
      actor(req)
    ),
  });
});
export function change(action: 'retry' | 'cancel' | 'delete'): RequestHandler {
  return asyncHandler(async (req, res) => {
    sendResponse(res, 200, {
      data: await service.changeEmbeddingVersion(
        connectionParams.parse(req.params).id,
        embeddingActionInput.parse(req.body).revision,
        actor(req),
        action
      ),
    });
    if (action === 'retry') wakeIndexWorker();
  });
}
