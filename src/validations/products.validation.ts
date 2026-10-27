import { discountSchema } from "./common.validation.js";
import { hasUpdateFields, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { ProductVariantInput, CreateProductInput, UpdateProductInput, GetProductsQuery } from "../types/products.type.js";
export type { ProductVariantInput, CreateProductInput, UpdateProductInput, GetProductsQuery } from "../types/products.type.js";
import { z } from "zod";
import { objectId, paginationSchema, idParamSchema } from "./common.validation.js";

// Shared catalog metadata and review input.
export const skuSchema = z.string().trim().toUpperCase().min(3).max(64).regex(/^[A-Z0-9-]+$/);
export const productDetailsShape = {
  sku: skuSchema.nullable().optional(),
  barcode: z.string().trim().min(1).max(64).nullable().optional(),
  currency: z.literal("VND").optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  weight: z.number().nonnegative().nullable().optional(), // kilograms
  dimensions: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative(), depth: z.number().nonnegative() }).nullable().optional(), // centimetres
  warrantyInformation: z.string().trim().max(2000).nullable().optional(),
  shippingInformation: z.string().trim().max(2000).nullable().optional(),
  returnPolicy: z.string().trim().max(2000).nullable().optional(),
  minimumOrderQuantity: z.int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
};

export const reviewInputSchema = z.object({
  rating: z.int().min(1).max(5),
  comment: z.string().trim().min(1).max(2000),
  reviewerName: z.string().trim().min(1).max(100),
  date: z.iso.datetime().optional(),
});

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
  stock: z.int().min(0).optional(),
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
  ...productDetailsShape,
  product_name: z.string().trim().min(3).max(255),
  price: z.number().min(0).optional(),
  discount: discountSchema.optional().default(0),
  category: objectId,
  brand: objectId,
  description: z.string().trim().max(2000).nullable().optional(),
  model_year: z.int()
    .min(1900)
    .max(new Date().getFullYear() + 2).nullable().optional(),
  slug: z.string().trim().min(3).max(255).optional(),
  thumbnail: z.string().trim().max(255).nullable().optional(),
  stock: z.int().min(0).optional(),
  is_active: z.boolean().optional().default(true),
  variants: z.array(productVariantSchema).optional().default([]),
}) satisfies z.ZodType<CreateProductInput>;

export const updateProductSchema = createProductSchema
  .partial()
  .extend({
    discount: discountSchema.optional(),
    is_active: z.boolean().optional(),
    variants: z.array(productVariantSchema).optional(),
    expectedVersion: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .refine(value => (value.variants === undefined && value.stock === undefined) || value.expectedVersion !== undefined, {
    path: ["expectedVersion"], error: "Read the product version before updating inventory or variants",
  })
  .refine(({ expectedVersion, ...fields }) => hasUpdateFields(fields), {
    error: UPDATE_REQUIRED_MESSAGE,
  }) satisfies z.ZodType<UpdateProductInput>;

export const productIdParamSchema = idParamSchema;

export const getProductsQuerySchema = paginationSchema.extend({
  stockStatus: z.enum(['in_stock', 'low_stock', 'out_of_stock']).optional(),
  search: z.string().trim().max(255).optional(),
  category: objectId.optional(),
  brand: objectId.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sortBy: z.enum(['product_name', 'price', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  sku: z.string().trim().min(1).optional(),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
}).refine(value => value.minPrice === undefined || value.maxPrice === undefined || value.minPrice <= value.maxPrice,
  { path: ['maxPrice'], error: 'Maximum price must be greater than or equal to minimum price' }) satisfies z.ZodType<GetProductsQuery>;

export const updateInventorySchema = z.strictObject({
  expectedVersion: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  stock: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  variants: z.array(z.strictObject({ _id: objectId, stock: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).min(1).optional(),
}).refine(value => (value.stock !== undefined) !== (value.variants !== undefined), { error: "Provide product stock or variant stocks, not both." });

// DummyJSON import contract.
const imageUrl = z.url().max(2048).refine(value => value.startsWith("https://"), "HTTPS image URLs required");
export const dummyProductSchema = z.object({
  id: z.int().positive().max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().min(1).max(255),
  brand: z.string().trim().min(1).max(255),
  price: z.number().nonnegative(),
  discountPercentage: z.number().min(0).max(70).default(0),
  stock: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sku: skuSchema,
  tags: productDetailsShape.tags,
  weight: productDetailsShape.weight,
  dimensions: productDetailsShape.dimensions,
  warrantyInformation: productDetailsShape.warrantyInformation,
  shippingInformation: productDetailsShape.shippingInformation,
  returnPolicy: productDetailsShape.returnPolicy,
  minimumOrderQuantity: productDetailsShape.minimumOrderQuantity,
  reviews: z.array(reviewInputSchema).max(200).default([]),
  thumbnail: imageUrl.optional(),
  images: z.array(imageUrl).max(8).default([]),
  meta: z.object({ barcode: z.string().trim().min(1).max(64).optional(), createdAt: z.iso.datetime().optional(), updatedAt: z.iso.datetime().optional() }).optional(),
});
export const importDummyProductSchema = z.object({
  product: dummyProductSchema,
  sourceCurrency: z.literal("USD"),
  exchangeRate: z.number().positive(),
  weightUnit: z.literal("kg"),
  dimensionUnit: z.literal("cm"),
  categoryId: objectId.optional(),
  brandId: objectId.optional(),
});
export type ImportDummyProductInput = z.infer<typeof importDummyProductSchema>;
