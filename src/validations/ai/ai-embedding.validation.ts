import {
  embeddingDefinition,
  validEmbedding,
} from '../../services/ai/embedding-catalog.js';
import { z } from 'zod';
export const embeddingVersionInput = z
  .object({
    revision: z.number().int().nonnegative(),
    connectionId: z.uuid(),
    engine: z.enum(['exact', 'atlas']).optional(),
    startSync: z.boolean().optional(),
    model: z.string().min(1).max(160),
    dimensions: z.number().int().min(1).max(4096),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.model) {
      const definition = embeddingDefinition(input.model);
      if (
        !definition ||
        !validEmbedding(definition.provider, input.model, input.dimensions)
      )
        context.addIssue({
          code: 'custom',
          path: ['model'],
          message: 'Model embedding và số chiều vector không tương thích.',
        });
    }
  });
export const embeddingActivationInput = z
  .object({
    revision: z.number().int().nonnegative(),
    generationId: z.uuid().nullable(),
  })
  .strict();
export const embeddingActionInput = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
