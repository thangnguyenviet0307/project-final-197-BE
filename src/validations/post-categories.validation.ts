import { z } from "zod";
import { hasUpdateFields } from "./common.validation.js";
const fields = {
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(500), isActive: z.boolean(),
};
export const createPostCategorySchema = z.strictObject({ ...fields, description: fields.description.default(""), isActive: fields.isActive.default(true) });
export const updatePostCategorySchema = z.strictObject(fields).partial().extend({ expectedVersion: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
  .refine(({ expectedVersion, ...rest }) => hasUpdateFields(rest), "Provide changed fields");
