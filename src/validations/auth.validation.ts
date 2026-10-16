import { z } from 'zod';
import { createUserSchema } from './user.validation.js';

export const loginSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ').toLowerCase(),
  password: z.string().min(1, 'Mật khẩu không được để trống'),
});

export const bootstrapSchema = createUserSchema;

export type LoginInput = z.infer<typeof loginSchema>;