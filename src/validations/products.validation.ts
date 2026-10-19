import { discountSchema } from "./common.validation.js";
import { hasUpdateFields, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { ProductVariantInput, CreateProductInput, UpdateProductInput, GetProductsQuery } from "../types/products.type.js";
export type { ProductVariantInput, CreateProductInput, UpdateProductInput, GetProductsQuery } from "../types/products.type.js";
import { z } from "zod";
import { objectId, paginationSchema, idParamSchema } from "./common.validation.js";

export const productVariantSchema = z.object({
  _id: objectId.optional(),
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
  stock: z.number().int().min(0).optional(),
  image: z.string().trim().max(255).nullable().optional(),
  images: z.array(z.string().trim().max(255)).optional(),
  attributes: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
}) satisfies z.ZodType<ProductVariantInput>;

export const createProductSchema = z.object({
  product_name: z.string().trim().min(3).max(255),
  price: z.number().min(0).optional(),
  discount: discountSchema.optional().default(0),
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
  stock: z.number().int().min(0).optional(),
  is_active: z.boolean().optional().default(true),
  variants: z.array(productVariantSchema).optional().default([]),
}) satisfies z.ZodType<CreateProductInput>;

export const updateProductSchema = createProductSchema
  .partial()
  .extend({
    discount: discountSchema.optional(),
    is_active: z.boolean().optional(),
    variants: z.array(productVariantSchema).optional(),
  })
  .refine(hasUpdateFields, {
    message: UPDATE_REQUIRED_MESSAGE,
  }) satisfies z.ZodType<UpdateProductInput>;

export const productIdParamSchema = idParamSchema;

export const getProductsQuerySchema = paginationSchema.extend({
  stockStatus: z.enum(['in_stock', 'low_stock', 'out_of_stock']).optional(),
  search: z.string().trim().max(255).optional(),
  category: objectId.optional(),
  brand: objectId.optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  sortBy: z.enum(['product_name', 'price', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  sku: z.string().trim().min(1).optional(),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
}).refine(value => value.minPrice === undefined || value.maxPrice === undefined || value.minPrice <= value.maxPrice,
  { path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price' }) satisfies z.ZodType<GetProductsQuery>;
