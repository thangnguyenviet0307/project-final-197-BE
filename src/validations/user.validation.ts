import { z } from 'zod';
import { paginationSchema } from './common.validation.js';

export const createUserSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ').toLowerCase(),
  password: z.string().min(6, 'Mật khẩu ít nhất 6 ký tự').max(100),
  firstName: z.string().trim().min(1, 'Họ không được để trống').max(50),
  lastName: z.string().trim().min(1, 'Tên không được để trống').max(50),
  role: z.enum(['admin', 'staff'], {
    message: 'Role phải là admin hoặc staff',
  }),
  active: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ').toLowerCase().optional(),
  password: z.string().min(6, 'Mật khẩu ít nhất 6 ký tự').max(100).optional(),
  firstName: z.string().trim().min(1, 'Họ không được để trống').max(50).optional(),
  lastName: z.string().trim().min(1, 'Tên không được để trống').max(50).optional(),
  role: z.enum(['admin', 'staff'], {
    error: () => ({ message: 'Role phải là admin hoặc staff' }),
  }).optional(),
  active: z.boolean().optional(),
});

export const getUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  role: z.string().optional(),
  active: z.coerce.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type GetUsersQuery = z.infer<typeof getUsersQuerySchema>;