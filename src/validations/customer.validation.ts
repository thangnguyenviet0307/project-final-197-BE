import { z } from 'zod';
import { paginationSchema } from './common.validation.js';

export const createCustomerSchema = z.object({
  firstName: z.string().trim().min(1, 'Họ không được để trống').max(50),
  lastName: z.string().trim().min(1, 'Tên không được để trống').max(50),
  email: z.string().trim().email('Email không hợp lệ').toLowerCase(),
  phone: z.string().trim().min(10, 'Số điện thoại không hợp lệ').max(15),
  address: z.object({
    street: z.string().trim().min(1, 'Địa chỉ không được để trống').max(255),
    city: z.string().trim().min(1, 'Thành phố không được để trống').max(50),
    state: z.string().trim().min(1, 'Tỉnh không được để trống').max(50),
  }),
  isActive: z.boolean().default(true),
});

export const updateCustomerSchema = createCustomerSchema.omit({ isActive: true }).partial().extend({ isActive: z.boolean().optional() });

export const getCustomersQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type GetCustomersQuery = z.infer<typeof getCustomersQuerySchema>;
