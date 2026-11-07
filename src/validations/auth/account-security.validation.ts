import { z } from 'zod';
import { createEmailSchema } from '../shared/common.validation.js';
import { changePasswordSchema } from './auth.validation.js';
import { updateProfileSchema } from '../users/profile.validation.js';

export const sendOtpSchema = z.strictObject({ email: createEmailSchema() });
export const verifyOtpSchema = sendOtpSchema.extend({
  otp: z.string().regex(/^\d{6}$/),
});
export const emailVerificationSchema = z.strictObject({
  otp: z.string().regex(/^\d{6}$/),
});
export const resetPasswordSchema = z.strictObject({
  email: createEmailSchema(),
  resetToken: z.string().regex(/^[a-f0-9]{64}$/),
  newPassword: changePasswordSchema.shape.newPassword,
});
export const onboardingProfileSchema = updateProfileSchema.extend({
  personalEmail: createEmailSchema(),
});
