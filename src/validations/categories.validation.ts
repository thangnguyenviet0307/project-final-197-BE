import { z } from "zod";
import { objectId } from "./common.validation.js";

export const createCategoriesSchema = z.object({
  name: z
    .string("Category name must be a string")
    .trim()
    .min(1, "Category name cannot be empty"),

  description: z.string("Description must be a string").trim().optional(),

  parent: objectId.nullable().optional(),

  isActive: z.boolean("isActive must be a boolean").optional(),
});

export const updateCategoriesSchema = createCategoriesSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required for update",
  });

export type CreateCategoriesInput = z.infer<typeof createCategoriesSchema>;
export type UpdateCategoriesInput = z.infer<typeof updateCategoriesSchema>;
