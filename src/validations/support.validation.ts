import { hasReadableContent } from './information.validation.js';
import { z } from 'zod';
import { objectId } from './common.validation.js';

export const policyContentSchema = z
  .object({
    privacy: z.string().trim().max(30000),
    warranty: z.string().trim().max(30000),
    returns: z.string().trim().max(30000),
    shipping: z.string().trim().max(30000),
    payment: z.string().trim().max(30000),
    support: z.string().trim().max(30000),
  })
  .strict();
export const savePolicySchema = z
  .object({
    content: policyContentSchema,
    publish: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) =>
      !value.publish || Object.values(value.content).every(hasReadableContent),
    {
      message: 'Vui lòng điền đủ các mục trước khi công bố chính sách.',
      path: ['content'],
    }
  );
export const warrantyStatuses = [
  'submitted',
  'reviewing',
  'repairing',
  'resolved',
  'rejected',
] as const;
export const supportListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    status: z.enum(warrantyStatuses).optional(),
  })
  .strict();
export const createWarrantySchema = z
  .object({
    requestId: z.uuid(),
    orderId: objectId,
    itemIndex: z.number().int().min(0).max(9999),
    description: z.string().trim().min(10).max(3000),
  })
  .strict();
export const updateWarrantySchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    status: z.enum(warrantyStatuses),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();
export type PolicyContent = z.infer<typeof policyContentSchema>;
export type WarrantyStatus = (typeof warrantyStatuses)[number];
export type CreateWarrantyInput = z.infer<typeof createWarrantySchema>;
export type UpdateWarrantyInput = z.infer<typeof updateWarrantySchema>;
export type SupportListInput = z.infer<typeof supportListSchema>;
