import type { LoginInput, BootstrapInput, RefreshInput } from "../types/auth.type.js";
export type { LoginInput, BootstrapInput, RefreshInput } from "../types/auth.type.js";
import { z } from "zod";
import { createUserSchema } from "./users.validation.js";
export const loginSchema = createUserSchema.pick({ email: true, password: true }) satisfies z.ZodType<LoginInput>;
// Registration never accepts roles, activation flags or administrative fields.
export const registerCustomerSchema = z.strictObject(createUserSchema.pick({ email: true, password: true, firstName: true, lastName: true }).shape);
export const bootstrapSchema = createUserSchema.omit({ role: true }).extend({
  active: z.literal(true).default(true),
}) satisfies z.ZodType<BootstrapInput>;
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }) satisfies z.ZodType<RefreshInput>;


export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(6, "New password must contain at least 6 characters.").max(1024).regex(
    /^(?=[\s\S]*[A-Z])(?=[\s\S]*[0-9])(?=[\s\S]*[^A-Za-z0-9\s])[\s\S]{6,}$/,
    "Use at least 6 characters, including an uppercase letter, a number, and a special character.",
  ),
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ["newPassword"], error: "New password must differ from the current password",
});
