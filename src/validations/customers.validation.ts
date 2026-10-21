import { createEmailSchema } from "./common.validation.js";
import { hasUpdateFields, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { CreateCustomerInput, UpdateCustomerInput, GetCustomersQuery } from "../types/customers.type.js";
export type { CreateCustomerInput, UpdateCustomerInput, GetCustomersQuery } from "../types/customers.type.js";
import { z } from 'zod';
import { paginationSchema, createAddressSchema } from './common.validation.js';

export const createCustomerSchema = z.object({
  firstName: z.string().trim().min(1, 'Họ không được để trống').max(50),
  lastName: z.string().trim().min(1, 'Tên không được để trống').max(50),
  email: createEmailSchema('Email không hợp lệ'),
  phone: z.string().trim().min(10, 'Số điện thoại không hợp lệ').max(15),
  address: createAddressSchema({ street: 'Địa chỉ không được để trống', city: 'Thành phố không được để trống', state: 'Tỉnh không được để trống' }),
  isActive: z.boolean().default(true),
}) satisfies z.ZodType<CreateCustomerInput>;

export const updateCustomerSchema = createCustomerSchema.omit({ isActive: true }).partial().extend({ isActive: z.boolean().optional() })
  .refine(hasUpdateFields, { error: UPDATE_REQUIRED_MESSAGE }) satisfies z.ZodType<UpdateCustomerInput>;

export const getCustomersQuerySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
}) satisfies z.ZodType<GetCustomersQuery>;
