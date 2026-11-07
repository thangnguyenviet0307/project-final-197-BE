import { accountSecurityController as security } from '../../../controllers/auth/account-security.controller.js';
import {
  emailVerificationSchema,
  onboardingProfileSchema,
} from '../../../validations/auth/account-security.validation.js';
import type { AuthenticatedRequest } from '../../../middlewares/auth/auth.middleware.js';
import { z } from 'zod';
import { Router, type Router as RouterType } from 'express';
import { authController } from '../../../controllers/auth/auth.controller.js';
import { validate } from '../../../middlewares/shared/validate.middleware.js';
import {
  changePasswordSchema,
  loginSchema,
  bootstrapSchema,
  refreshSchema,
} from '../../../validations/auth/auth.validation.js';

import { authenticate } from '../../../middlewares/auth/auth.middleware.js';
import { createAuthRateLimit } from '../../../middlewares/auth/auth-rate-limit.middleware.js';

import { parseProfileUpload } from '../../../middlewares/auth/profile-upload.middleware.js';
import { updateProfileSchema } from '../../../validations/users/profile.validation.js';

import { cookieAuthTransport } from '../../../utils/auth/auth-cookie.js';

const router: RouterType = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(cookieAuthTransport);
const rateLimit = createAuthRateLimit();
router.post('/register', (_req, res) => {
  res
    .status(410)
    .json({ success: false, message: 'Use /customer-auth/register' });
});

router.post(
  '/bootstrap',
  rateLimit,
  validate({ body: bootstrapSchema }),
  authController['bootstrapAdmin']!
);

router.post(
  '/login',
  rateLimit,
  validate({ body: loginSchema }),
  authController['login']!
);
router.post(
  '/refresh',
  rateLimit,
  validate({ body: refreshSchema }),
  authController['refresh']!
);
router.post('/logout', authenticate, authController['logout']!);

router.patch(
  '/me',
  authenticate,
  parseProfileUpload,
  validate({ body: updateProfileSchema }),
  authController['updateProfile']!
);
router.get('/me', authenticate, authController['me']!);
router.post(
  '/change-password',
  authenticate,
  rateLimit,
  validate({ body: changePasswordSchema }),
  authController['changePassword']!
);

const emailIpLimit = createAuthRateLimit(30);
const emailAccountLimit = createAuthRateLimit(
  10,
  15 * 60 * 1000,
  'Too many email verification requests',
  (req) => (req as AuthenticatedRequest).user!.id
);
router.patch(
  '/onboarding/profile',
  authenticate,
  validate({ body: onboardingProfileSchema }),
  authController['updateProfile']!
);
router.post(
  '/email-verification/send-otp',
  authenticate,
  emailIpLimit,
  emailAccountLimit,
  validate({ body: z.strictObject({}) }),
  security['sendEmailVerification']!
);
router.post(
  '/email-verification/verify-otp',
  authenticate,
  emailIpLimit,
  emailAccountLimit,
  validate({ body: emailVerificationSchema }),
  security['verifyEmail']!
);
export default router;
