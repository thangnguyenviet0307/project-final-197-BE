import type { LoginInput, BootstrapInput, RefreshInput } from "../types/auth.type.js";
export type { LoginInput, BootstrapInput, RefreshInput } from "../types/auth.type.js";
import { z } from "zod";
import { createUserSchema } from "./users.validation.js";
export const loginSchema = createUserSchema.pick({ email: true, password: true }) satisfies z.ZodType<LoginInput>;
export const bootstrapSchema = createUserSchema.omit({ role: true }).extend({
  active: z.literal(true).default(true),
}) satisfies z.ZodType<BootstrapInput>;
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }) satisfies z.ZodType<RefreshInput>;
