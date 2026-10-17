import { z } from "zod";
import { paginationSchema } from "./common.validation.js";
export const createUserSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(6).max(1024),
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  role: z.enum(["admin", "staff"]).default("staff"),
  active: z.boolean().default(true),
});
export const updateUserSchema = createUserSchema.omit({ role: true, active: true }).partial().extend({
  role: z.enum(["admin", "staff"]).optional(),
  active: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field is required for update" },
);
export const getUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type GetUsersQuery = z.infer<typeof getUsersQuerySchema>;
