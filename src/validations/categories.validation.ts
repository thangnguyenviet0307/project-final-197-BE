import { z } from "zod";
export const createCategoriesSchema = z.object({
  body: z.object({
    name: z
      .string("Category name must be a string")
      .trim()
      .min(1, "Category name cannot be empty"),
    
    description: z
      .string("Description must be a string")
      .trim()
      .optional(),
    
    parent: z
      .string("Parent ID must be a valid string")
      .nullable()
      .optional(),
    
    isActive: z
      .boolean("isActive must be a boolean")
      .optional(),
  }),
});

// Zod schema for updating a category (all fields optional)
export const updateCategoriesSchema = z.object({
  body: z.object({
    name: z
      .string("Category name must be a string")
      .trim()
      .min(1, "Category name cannot be empty")
      .optional(),
    
    description: z
      .string("Description must be a string")
      .trim()
      .optional(),
    
    parent: z
      .string("Parent ID must be a valid string")
      .nullable()
      .optional(),
    
    isActive: z
      .boolean("isActive must be a boolean")
      .optional(),
  }),
});

// Export inferred TypeScript types from Zod schemas
export type CreateCategoriesInput = z.infer<typeof createCategoriesSchema>;
export type UpdateCategoriesInput = z.infer<typeof updateCategoriesSchema>;