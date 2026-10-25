import { z } from "zod";

// Explicit allowlist: account email, role, active, password, and target ID cannot be changed here.
export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  personalEmail: z.union([z.string().trim().email().toLowerCase(), z.literal("")]).default(""),
  phone: z.string().trim().max(30).default(""),
  location: z.string().trim().max(255).default(""),
  bio: z.string().trim().max(1000).default(""),
  avatar: z.literal("").optional(),
}).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
