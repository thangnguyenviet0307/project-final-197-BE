import type { LoginInput, BootstrapInput, RefreshInput } from "../types/auth.type.js";
export type { LoginInput, BootstrapInput, RefreshInput } from "../types/auth.type.js";
import { z } from "zod";
import { createUserSchema } from "./users.validation.js";
export const loginAreaSchema = z.enum(["storefront", "admin"]).optional();
export const loginSchema = createUserSchema.pick({ email: true, password: true }) satisfies z.ZodType<LoginInput>;
// Public registration accepts credentials only, never roles or session flags.
export const registerCustomerSchema = createUserSchema.pick({
  email: true, password: true, firstName: true, lastName: true,
}).strict() satisfies z.ZodType<import("../types/auth.type.js").RegisterCustomerInput>;

export const bootstrapSchema = createUserSchema.omit({ role: true }).extend({
  active: z.literal(true).default(true),
}) satisfies z.ZodType<BootstrapInput>;
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }) satisfies z.ZodType<RefreshInput>;


export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(6).max(1024),
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ["newPassword"], message: "New password must differ from the current password",
});
