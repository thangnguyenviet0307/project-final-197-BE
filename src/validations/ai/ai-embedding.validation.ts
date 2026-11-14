import { z } from 'zod';
export const embeddingVersionInput = z
  .object({
    revision: z.number().int().nonnegative(),
    connectionId: z.uuid(),
    engine: z.enum(['exact', 'atlas']).optional(),
    startSync: z.boolean().optional(),
    model: z.enum(['gemini-embedding-001', 'gemini-embedding-2']),
    dimensions: z.union([z.literal(768), z.literal(1536), z.literal(3072)]),
  })
  .strict();
export const embeddingActivationInput = z
  .object({
    revision: z.number().int().nonnegative(),
    generationId: z.uuid().nullable(),
  })
  .strict();
export const embeddingActionInput = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
