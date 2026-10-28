import { Categories } from '../models/categories.model.js';
import { BrandModel } from '../models/brands.model.js';
import Product from '../models/products.model.js';
import { escapeRegex } from './search.js';
import type { GetProductsQuery } from '../types/products.type.js';

export function buildProductQuery(filters: Partial<GetProductsQuery>): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const variants: Record<string, unknown> = {};
  for (const field of ["on_sale", "is_best_seller", "is_new", "is_hot", "is_home"] as const) {
    if (filters[field] === undefined) continue;
    query[field] = field === "on_sale"
      ? (filters[field] ? { $ne: false } : false)
      : (filters[field] ? true : { $ne: true });
  }
  if (filters.sku) query['$or'] = [{ sku: filters.sku.trim().toUpperCase() }, { 'variants.sku': filters.sku.trim().toUpperCase() }];
  if (filters.sku && (filters.color || filters.size)) {
    delete query['$or'];
    variants['sku'] = filters.sku.trim().toUpperCase();
  }
  if (filters.color) variants['color'] = { $regex: escapeRegex(filters.color.trim()), $options: 'i' };
  if (filters.size) variants['size'] = { $regex: escapeRegex(filters.size.trim()), $options: 'i' };
  if (Object.keys(variants).length) query['variants'] = { $elemMatch: variants };

  if (filters.search) query['product_name'] = { $regex: escapeRegex(filters.search.trim()), $options: 'i' };
  for (const field of ['category', 'brand'] as const) {
    if (!filters[field]) continue;
    const ids = [...new Set(filters[field].split(','))];
    query[field] = ids.length === 1 ? ids[0] : { $in: ids };
  }
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) query['$expr'] = { $and: [
    ...(filters.minPrice !== undefined ? [{ $gte: [effectivePriceExpression, filters.minPrice] }] : []),
    ...(filters.maxPrice !== undefined ? [{ $lte: [effectivePriceExpression, filters.maxPrice] }] : []),
  ] };
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

// Use the same cheapest variant, product discount and half-up cent rounding as the cards.
export const effectivePriceExpression = { $toDouble: { $divide: [{ $floor: { $add: [
  { $multiply: [
    { $toDecimal: { $cond: [{ $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] }, { $min: '$variants.price' }, '$price'] } },
    { $subtract: [100, { $toDecimal: { $ifNull: ['$discount', 0] } }] },
  ] }, 0.5,
] } }, 100] } };

export async function buildProductSearchQuery(filters: Partial<GetProductsQuery>) {
  const query = buildProductQuery(filters);
  if (!filters.search?.trim()) return query;
  delete query['product_name'];
  const name = { $regex: escapeRegex(filters.search.trim()), $options: 'i' };
  const [brands, categories] = await Promise.all([
    BrandModel.distinct('_id', { name, isDeleted: { $ne: true } }),
    Categories.distinct('_id', { name, isDeleted: { $ne: true } }),
  ]);
  // Keep SKU, explicit brand/category and search as independent AND conditions.
  return { $and: [query, { $or: [{ product_name: name }, { brand: { $in: brands } }, { category: { $in: categories } }] }] };
}

export async function discountedPricePageIds(query: Record<string, unknown>, filters: Partial<GetProductsQuery>, page: number, limit: number) {
  const match = Product.find(query).cast();
  const direction = filters.sortOrder === 'asc' ? 1 : -1;
  const rows = await Product.aggregate<{ _id: unknown }>([
    { $match: match }, { $set: { sellingPrice: effectivePriceExpression } },
    { $sort: { sellingPrice: direction, _id: direction } },
    { $skip: (page - 1) * limit }, { $limit: limit }, { $project: { _id: 1 } },
  ]);
  return rows.map(row => row._id);
}
