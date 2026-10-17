import { z } from "zod";
import { createUserSchema } from "./user.validation.js";
export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(6).max(1024),
});
export const bootstrapSchema = createUserSchema.omit({ role: true }).extend({
  active: z.literal(true).default(true),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) });
