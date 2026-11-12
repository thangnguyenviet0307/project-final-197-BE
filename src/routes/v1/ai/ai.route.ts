import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import * as controller from '../../../controllers/ai/ai.controller.js';
import * as embeddings from '../../../controllers/ai/ai-embedding.controller.js';
import * as settings from '../../../controllers/ai/ai-settings.controller.js';
import {
  aiIdentity,
  aiOrigin,
  initializeAiSession,
} from '../../../services/ai/identity.service.js';
import { validate } from '../../../middlewares/shared/validate.middleware.js';
import { createAuthRateLimit } from '../../../middlewares/auth/auth-rate-limit.middleware.js';
import {
  authenticate,
  requirePermission,
} from '../../../middlewares/auth/auth.middleware.js';
import { Permission } from '../../../types/shared/permissions.type.js';
import { reserveUsage } from '../../../services/ai/usage.service.js';
import { digest } from '../../../services/ai/identity.service.js';
import { asyncHandler } from '../../../utils/shared/async-handler.util.js';
import {
  aiSearchSchema,
  conversationParams,
  historyQuery,
  cancelTurnSchema,
} from '../../../validations/ai/ai.validation.js';
const router: ExpressRouter = Router();
router.use(aiOrigin);
const admin = Router();
admin.use(authenticate, requirePermission(Permission.AiView));
const adminRateLimit = createAuthRateLimit(30, 60000);
admin.get('/settings', adminRateLimit, settings.read);
admin.get('/embeddings', adminRateLimit, embeddings.read);
admin.get('/status', adminRateLimit, controller.status);
// Every operation below can change configuration, data, state or provider usage.
admin.use(requirePermission(Permission.AiManage), adminRateLimit);
admin.delete('/settings/audit', settings.clearAudit);
admin.post('/embeddings', embeddings.create);
admin.post('/embeddings/activate', embeddings.activate);
admin.post('/embeddings/:id/retry', embeddings.change('retry'));
admin.post('/embeddings/:id/cancel', embeddings.change('cancel'));
admin.delete('/embeddings/:id', embeddings.change('delete'));
admin.post('/settings/initialize', settings.initialize);
admin.put('/settings', settings.save);
admin.post('/connections', settings.create);
admin.put('/connections/:id', settings.update);
admin.delete('/connections/:id', settings.remove);
admin.post(
  '/connections/:id/test',
  createAuthRateLimit(4, 60000),
  settings.test
);
admin.post('/reindex', controller.reindex);
router.use('/admin', admin);
router.use(createAuthRateLimit(60, 60000));
router.use(
  asyncHandler(async (req, _res, next) => {
    await reserveUsage('http:' + digest(req.ip || 'unknown'), 80, 60000);
    next();
  })
);
router.get('/search', validate({ query: aiSearchSchema }), controller.search);
router.get(
  '/conversations',
  aiIdentity,
  validate({ query: historyQuery }),
  controller.list
);
router.post(
  '/conversations',
  aiIdentity,
  createAuthRateLimit(10, 60000),
  validate(z.object({}).strict()),
  controller.create
);
router.get(
  '/conversations/:id/messages',
  aiIdentity,
  validate({ params: conversationParams, query: historyQuery }),
  controller.history
);
router.post(
  '/conversations/:id/cancel',
  aiIdentity,
  validate({ params: conversationParams, body: cancelTurnSchema }),
  controller.cancel
);
router.post(
  '/conversations/:id/end',
  aiIdentity,
  validate({ params: conversationParams, body: z.object({}).strict() }),
  controller.end
);
router.post(
  '/socket-ticket',
  aiIdentity,
  createAuthRateLimit(15, 60000),
  validate(z.object({}).strict()),
  controller.ticket
);
router.post(
  '/session',
  validate(z.object({}).strict()),
  initializeAiSession,
  (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Session ready',
      data: null,
    });
  }
);
export default router;
