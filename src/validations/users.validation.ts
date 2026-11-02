import { userRoleSchema, createEmailSchema } from "./common.validation.js";
import { hasUpdateFields, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { CreateUserInput, UpdateUserInput, GetUsersQuery } from "../types/users.type.js";
export type { CreateUserInput, UpdateUserInput, GetUsersQuery } from "../types/users.type.js";
import { z } from "zod";
import { paginationSchema } from "./common.validation.js";
import { objectId } from "./common.validation.js";
export const transferOwnershipSchema = z.strictObject({ targetUserId: objectId, currentPassword: z.string().min(1).max(1024) });
export const createUserSchema = z.object({
  email: createEmailSchema(),
  password: z.string().min(6).max(1024),
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  role: userRoleSchema.default("staff"),
  active: z.boolean().default(true),
}) satisfies z.ZodType<CreateUserInput>;
export const updateUserSchema = createUserSchema.omit({ role: true, active: true }).partial().extend({
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
}).refine(
  hasUpdateFields,
  { error: UPDATE_REQUIRED_MESSAGE },
) satisfies z.ZodType<UpdateUserInput>;
export const getUsersQuerySchema = paginationSchema.extend({
  role: z.enum(["super_admin", "admin", "staff"]).optional(),
  active: z.union([z.boolean(), z.enum(["true", "false"]).transform(value => value === "true")]).optional(),
  sortBy: z.enum(["username"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().trim().max(200).optional(),
}) satisfies z.ZodType<GetUsersQuery>;
