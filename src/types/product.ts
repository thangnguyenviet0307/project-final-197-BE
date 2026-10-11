export type ProductVariant = {
  _id?: string;
  sku: string;
  variant_name?: string | null;
  color?: string | null;
  size?: string | null;
  price: number;
  compare_at_price?: number | null;
  stock?: number;
  image?: string | null;
  images?: string[];
  attributes?: Record<string, string | number | boolean | null>;
};

export type TProduct = {
  id?: string;
  product_name: string;
  description?: string | null;
  price?: number;
  discount?: number;
  category: string;
  brand: string;
  model_year: number;
  slug: string;
  thumbnail?: string | null;
  stock?: number;
  is_active?: boolean;
  variants?: ProductVariant[];
  createdAt?: Date;
  updatedAt?: Date;
};

export type CreateProductDto = {
  product_name: string;
  description?: string | null;
  price?: number;
  discount?: number;
  category: string;
  brand: string;
  model_year: number;
  slug?: string;
  thumbnail?: string | null;
  stock?: number;
  is_active?: boolean;
  variants?: ProductVariant[];
};

export type UpdateProductDto = Partial<CreateProductDto>;

export type QueryParams = {
  limit?: number;
  page?: number;
  search?: string;
  category?: string;
  brand?: string;
  sortBy?: string;
  sortType?: "asc" | "desc";
};
