import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import * as controller from '../../../controllers/ai/ai.controller.js';
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
router.get(
  '/admin/status',
  authenticate,
  requirePermission(Permission.AiManage),
  controller.status
);
router.post(
  '/admin/reindex',
  authenticate,
  requirePermission(Permission.AiManage),
  controller.reindex
);
router.use(createAuthRateLimit(60, 60000));
router.use(
  asyncHandler(async (req, _res, next) => {
    await reserveUsage('http:' + digest(req.ip || 'unknown'), 80, 60000);
    next();
  })
);
router.get('/search', validate({ query: aiSearchSchema }), controller.search);
router.get(
  '/recommendations/:slug',
  validate({ params: z.object({ slug: z.string().min(1).max(255) }).strict() }),
  controller.recommendations
);
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
