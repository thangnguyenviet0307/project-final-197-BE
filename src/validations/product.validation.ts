import { z } from "zod";
import { objectId, paginationSchema } from "./common.validation.js";

export const productVariantSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(3, "SKU phải có ít nhất 3 ký tự")
    .max(64, "SKU tối đa 64 ký tự")
    .regex(/^[A-Z0-9-]+$/, "SKU chỉ được chứa chữ cái, số và dấu gạch ngang"),
  variant_name: z.string().trim().min(1).max(100).nullable().optional(),
  color: z.string().trim().max(50).nullable().optional(),
  size: z.string().trim().max(50).nullable().optional(),
  price: z.number().min(0, "Giá biến thể không được nhỏ hơn 0"),
  compare_at_price: z.number().min(0).nullable().optional(),
  stock: z.number().int().min(0).optional().default(0),
  image: z.string().trim().max(255).nullable().optional(),
  images: z.array(z.string().trim().max(255)).optional().default([]),
  attributes: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional()
    .default({}),
});

export const createProductSchema = z.object({
  product_name: z.string().trim().min(3).max(255),
  price: z.number().min(0).optional().default(0),
  discount: z.number().min(0).max(70).optional().default(0),
  category: objectId,
  brand: objectId,
  description: z.string().trim().max(2000).nullable().optional(),
  model_year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 2),
  slug: z.string().trim().min(3).max(255).optional(),
  thumbnail: z.string().trim().max(255).nullable().optional(),
  stock: z.number().int().min(0).optional().default(0),
  is_active: z.boolean().optional().default(true),
  variants: z.array(productVariantSchema).optional().default([]),
});

export const updateProductSchema = createProductSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required for update",
  });

export const productIdParamSchema = z.object({ id: objectId });

export const getProductsQuerySchema = paginationSchema.extend({
  sku: z.string().trim().min(1).optional(),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
