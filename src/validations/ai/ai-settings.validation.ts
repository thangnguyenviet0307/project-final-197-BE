import { compatibleChatModel } from '../../services/ai/providers/catalog.js';
import { z } from 'zod';
export const settingsRevision = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const connectionInput = z
  .object({
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(80),
    provider: z.enum(['gemini', 'openai', 'xai']),
    model: z.string().trim().min(1).max(107),
    apiKey: z.string().trim().min(12).max(1024).regex(/^\S+$/).optional(),
  })
  .strict()
  .refine((value) => compatibleChatModel(value.provider, value.model), {
    message: 'Model is not compatible with this provider',
    path: ['model'],
  });
export const settingsInput = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    semanticEnabled: z.boolean(),
    indexingEnabled: z.boolean(),
    riskEnabled: z.boolean(),
    dailyCalls: z.number().int().min(1).max(100000),
    activeConnectionId: z.uuid().nullable(),
  })
  .strict();
export const connectionParams = z.object({ id: z.uuid() }).strict();
