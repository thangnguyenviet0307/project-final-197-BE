import { escapeRegex } from './search.js';
import type { GetProductsQuery } from '../types/products.type.js';

export function buildProductQuery(filters: Partial<GetProductsQuery>): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const variants: Record<string, unknown> = {};
  if (filters.sku) query['$or'] = [{ sku: filters.sku.trim().toUpperCase() }, { 'variants.sku': filters.sku.trim().toUpperCase() }];
  if (filters.sku && (filters.color || filters.size)) {
    delete query['$or'];
    variants['sku'] = filters.sku.trim().toUpperCase();
  }
  if (filters.color) variants['color'] = { $regex: escapeRegex(filters.color.trim()), $options: 'i' };
  if (filters.size) variants['size'] = { $regex: escapeRegex(filters.size.trim()), $options: 'i' };
  if (Object.keys(variants).length) query['variants'] = { $elemMatch: variants };
  if (filters.search) query['product_name'] = { $regex: escapeRegex(filters.search), $options: 'i' };
  if (filters.category) query['category'] = filters.category;
  if (filters.brand) query['brand'] = filters.brand;
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) query['price'] = {
    ...(filters.minPrice !== undefined ? { $gte: filters.minPrice } : {}),
    ...(filters.maxPrice !== undefined ? { $lte: filters.maxPrice } : {}),
  };
  if (filters.stockStatus === 'in_stock') query['stock'] = { $gt: 0 };
  if (filters.stockStatus === 'low_stock') query['stock'] = { $gte: 1, $lte: 5 };
  if (filters.stockStatus === 'out_of_stock') query['stock'] = 0;
  return query;
}
export function buildProductSort(filters: Partial<GetProductsQuery>): Record<string, 1 | -1> {
  const field = filters.sortBy ?? 'createdAt';
  const direction = filters.sortOrder === 'asc' ? 1 : -1;
  return { [field]: direction, _id: direction };
}
