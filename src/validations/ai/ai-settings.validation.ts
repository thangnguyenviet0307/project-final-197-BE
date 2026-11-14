import { z } from 'zod';
export const activationInput = z
  .object({
    revision: z.number().int().nonnegative(),
    confirm: z.literal(true),
  })
  .strict();
export const settingsRevision = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const settingsInput = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    semanticEnabled: z.boolean(),
    indexingEnabled: z.boolean(),
    riskEnabled: z.boolean(),
  })
  .strict();
export const connectionParams = z.object({ id: z.uuid() }).strict();
