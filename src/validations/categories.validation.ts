import { hasUpdateFields, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { CreateCategoriesInput, UpdateCategoriesInput } from "../types/categories.js";
export type { CreateCategoriesInput, UpdateCategoriesInput } from "../types/categories.js";
import { z } from "zod";
import { objectId } from "./common.validation.js";

export const createCategoriesSchema = z.object({
  icon: z.union([z.string().trim().check(z.url()).regex(/^https?:\/\//i).max(255), z.literal("")]).optional(),
  name: z
    .string("Category name must be a string")
    .trim()
    .min(1, "Category name cannot be empty"),

  description: z.string("Description must be a string").trim().optional(),

  parent: objectId.nullable().optional(),

  isActive: z.boolean("isActive must be a boolean").optional(),
}).strict() satisfies z.ZodType<CreateCategoriesInput>;

export const updateCategoriesSchema = createCategoriesSchema
  .partial()
  .refine(hasUpdateFields, {
    error: UPDATE_REQUIRED_MESSAGE,
  }) satisfies z.ZodType<UpdateCategoriesInput>;
