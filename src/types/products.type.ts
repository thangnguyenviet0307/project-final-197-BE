import type { IPaginationQuery, OptionalUpdate } from "./common.types.js";

export interface ProductVariantInput {
  _id?: string | undefined;
  sku: string;
  variant_name?: string | null | undefined;
  color?: string | null | undefined;
  size?: string | null | undefined;
  price: number;
  compare_at_price?: number | null | undefined;
  stock?: number | undefined;
  image?: string | null | undefined;
  images?: string[] | undefined;
  attributes?: Record<string, string | number | boolean | null> | undefined;
}
export interface ProductVariant extends ProductVariantInput {}

// Request fields before validation applies defaults.
export interface ProductInput {
  product_name: string;
  price?: number | undefined;
  discount?: number | undefined;
  category: string;
  brand: string;
  description?: string | null | undefined;
  model_year: number;
  slug?: string | undefined;
  thumbnail?: string | null | undefined;
  stock?: number | undefined;
  is_active?: boolean | undefined;
  variants?: ProductVariantInput[] | undefined;
}

// Validated create data: Zod has supplied these defaults.
export interface CreateProductInput extends ProductInput {
  discount: number;
  is_active: boolean;
  variants: ProductVariantInput[];
}
export interface UpdateProductInput extends OptionalUpdate<ProductInput> { expectedVersion?: number | undefined; }
export interface GetProductsQuery extends IPaginationQuery {
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock' | undefined;
  search?: string | undefined;
  category?: string | undefined;
  brand?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sortBy?: 'product_name' | 'price' | 'createdAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  sku?: string | undefined;
  color?: string | undefined;
  size?: string | undefined;
}
export type CreateProductDto = ProductInput;
export type UpdateProductDto = UpdateProductInput;
export interface TProduct extends ProductInput {
  id?: string;
  slug: string;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface QueryParams {
  limit?: number; page?: number; search?: string; category?: string; brand?: string;
  sortBy?: string; sortType?: "asc" | "desc";
}
