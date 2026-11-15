import { z } from 'zod';
export const recordKind = z.enum(['failures', 'usage', 'risks']);
export const recordPaging = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export const recordDeletion = z
  .object({
    confirm: z.literal(true),
    version: z.union([z.string().max(40), z.number().int().nonnegative()]),
  })
  .strict();
export const recordId = z.string().min(1).max(100);
