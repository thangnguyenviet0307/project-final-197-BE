import Product from "../models/products.model.js";
import { buildProductSearchQuery, discountedPricePageIds, buildProductSort } from "../utils/product-query.js";
import { buildPagination } from "../utils/pagination.js";
import type { GetProductsQuery } from "../types/products.type.js";
import { Categories } from "../models/categories.model.js";
import { BrandModel } from "../models/brands.model.js";

// Explicit public fields: import provenance and optimistic concurrency stay private.
export const publicProductFields = "_id product_name slug sku price discount category brand description model_year thumbnail images.secure_url sourceImages stock is_active on_sale count_view is_best_seller is_new is_hot is_home variants._id variants.sku variants.variant_name variants.color variants.size variants.price variants.compare_at_price variants.stock variants.image variants.images variants.attributes tags weight dimensions warrantyInformation shippingInformation returnPolicy minimumOrderQuantity currency";
const references = [{ path: "category", select: "_id name" }, { path: "brand", select: "_id name" }];

export async function visibleCatalogFilter(): Promise<Record<string, unknown>> {
  const active = { isActive: true, isDeleted: { $ne: true } };
  const [categories, brands] = await Promise.all([Categories.distinct('_id', active), BrandModel.distinct('_id', active)]);
  return { on_sale: { $ne: false }, category: { $in: categories }, brand: { $in: brands } };
}

export async function listStoreProducts(filters: Partial<GetProductsQuery>) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 12;
  const query: Record<string, unknown> = { $and: [await buildProductSearchQuery(filters), await visibleCatalogFilter()], is_active: true };
  const priceIds = filters.sortBy === 'price' ? await discountedPricePageIds(query, filters, page, limit) : null;
  const [data, total] = await Promise.all([
    priceIds ? Product.find({ $and: [query, { _id: { $in: priceIds } }] }).select(publicProductFields).populate(references).lean() : Product.find(query).select(publicProductFields).populate(references).sort(buildProductSort(filters)).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(query),
  ]);
  if (priceIds) { const positions = new Map(priceIds.map((id, index) => [String(id), index])); data.sort((a, b) => positions.get(String(a._id))! - positions.get(String(b._id))!); }
  return { data, pagination: buildPagination(page, limit, total) };
}

export async function getStoreProduct(slug: string) {
  return Product.findOne({ slug, is_active: true, ...await visibleCatalogFilter() }).select(publicProductFields).populate(references).lean();
}

export async function relatedStoreProducts(product: { _id: unknown; category: unknown; tags?: string[] }) {
  const category = product.category && typeof product.category === 'object' && '_id' in product.category ? product.category._id : product.category;
  const query: Record<string, unknown> = {
    _id: { $ne: product._id }, is_active: true,
    $and: [await visibleCatalogFilter(), { category }],
  };
  return Product.find(query).select(publicProductFields).populate(references).sort({ createdAt: -1, _id: -1 }).limit(5).lean();
}

// Atomic counter writes deliberately leave metadata/inventory __v and updatedAt unchanged.
export async function recordStoreProductView(slug: string) {
  return Product.findOneAndUpdate(
    { slug, is_active: true, ...await visibleCatalogFilter() },
    { $inc: { count_view: 1 } },
    { returnDocument: "after", timestamps: false },
  ).select("count_view -_id").lean();
}
