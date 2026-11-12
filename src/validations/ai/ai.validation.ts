import { z } from 'zod';
export const conversationParams = z
  .object({ id: z.string().regex(/^[a-f0-9]{24}$/i) })
  .strict();
export const aiSearchSchema = z
  .object({
    q: z.string().trim().min(1).max(300),
    page: z.coerce.number().int().min(1).max(20).default(1),
    limit: z.coerce.number().int().min(1).max(20).default(10),
    category: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .optional(),
    brand: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .optional(),
    minPrice: z.coerce.number().finite().nonnegative().optional(),
    maxPrice: z.coerce.number().finite().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.minPrice === undefined ||
      v.maxPrice === undefined ||
      v.minPrice <= v.maxPrice
  );
export const chatEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('chat:send'),
      conversationId: z.string().regex(/^[a-f0-9]{24}$/i),
      requestId: z.uuid(),
      content: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z.object({ type: z.literal('chat:cancel'), requestId: z.uuid() }).strict(),
]);
export const historyQuery = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
export const cancelTurnSchema = z
  .object({
    requestId: z.uuid(),
    content: z.string().trim().min(1).max(2000),
  })
  .strict();
