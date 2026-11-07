import { Router, type Router as RouterType } from 'express';
import { userController } from '../../../controllers/users/users.controller.js';
import {
  authenticate,
  requirePermission,
  type AuthenticatedRequest,
} from '../../../middlewares/auth/auth.middleware.js';
import { validate } from '../../../middlewares/shared/validate.middleware.js';
import { Permission } from '../../../types/shared/permissions.type.js';
import { idParamSchema } from '../../../validations/shared/common.validation.js';
import {
  createUserSchema,
  getUsersQuerySchema,
  updateUserSchema,
  transferOwnershipSchema,
} from '../../../validations/users/users.validation.js';
import { createAuthRateLimit } from '../../../middlewares/auth/auth-rate-limit.middleware.js';

import { z } from 'zod';
import { changePasswordSchema } from '../../../validations/auth/auth.validation.js';
const router: RouterType = Router();

router.use(authenticate);
const ownershipAccountLimit = createAuthRateLimit(
  5,
  15 * 60 * 1000,
  'Too many ownership transfer attempts; retry later',
  (req) => (req as AuthenticatedRequest).user!.id
);
const ownershipIpLimit = createAuthRateLimit(20);
router.post(
  '/transfer-ownership',
  requirePermission(Permission.OwnershipTransfer),
  ownershipAccountLimit,
  ownershipIpLimit,
  validate({ body: transferOwnershipSchema }),
  userController['transferOwnership']!
);
router.post(
  '/:id/revoke-sessions',
  requirePermission(Permission.UserUpdate),
  validate({ params: idParamSchema }),
  userController['revokeSessions']!
);

router.get(
  '/',
  requirePermission(Permission.UserView),
  validate({ query: getUsersQuerySchema }),
  userController['getUsers']!
);
router.get(
  '/:id',
  requirePermission(Permission.UserView),
  validate({ params: idParamSchema }),
  userController['getUserById']!
);
router.post(
  '/',
  requirePermission(Permission.UserCreate),
  validate({ body: createUserSchema }),
  userController['createUser']!
);
router.put(
  '/:id',
  requirePermission(Permission.UserUpdate),
  validate({ params: idParamSchema, body: updateUserSchema }),
  userController['updateUser']!
);
router.delete(
  '/:id',
  requirePermission(Permission.UserDelete),
  validate({ params: idParamSchema }),
  userController['deleteUser']!
);

const passwordResetLimit = createAuthRateLimit(
  5,
  15 * 60 * 1000,
  'Too many password reset requests',
  (req) => (req as AuthenticatedRequest).user!.id
);
router.post(
  '/:id/reset-password',
  requirePermission(Permission.UserUpdate),
  passwordResetLimit,
  validate({ params: idParamSchema, body: z.strictObject({}) }),
  userController['resetPassword']!
);
router.post(
  '/:id/reissue-initial-password',
  requirePermission(Permission.UserUpdate),
  passwordResetLimit,
  validate({
    params: idParamSchema,
    body: z.strictObject({ password: changePasswordSchema.shape.newPassword }),
  }),
  userController['reissueInitialPassword']!
);
export default router;
