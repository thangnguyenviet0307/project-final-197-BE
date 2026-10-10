
import { z } from "zod";

// Schema tạo thương hiệu
export const createBrandSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Brand name is required")
    .max(100, "Brand name must not exceed 100 characters"),

  description: z
    .string()
    .trim()
    .optional(),
});

// Schema cập nhật thương hiệu
export const updateBrandSchema = createBrandSchema
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field is required for update",
    }
  );

// TypeScript Types
export type BrandInput = z.infer<typeof createBrandSchema>;

export type UpdateBrandInput = z.infer<
  typeof updateBrandSchema
>;
