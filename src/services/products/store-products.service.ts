import {
  categoryMembership,
  expandPublicCategoryFilter,
} from '../../utils/products/catalog-reference.js';
import Product from '../../models/products/products.model.js';
import {
  buildProductSearchQuery,
  discountedPricePageIds,
  buildProductSort,
} from '../../utils/products/product-query.js';
import { buildPagination } from '../../utils/shared/pagination.js';
import type { GetProductsQuery } from '../../types/products/products.type.js';
import { Categories } from '../../models/categories/categories.model.js';
import { BrandModel } from '../../models/brands/brands.model.js';

// Explicit public fields: import provenance and optimistic concurrency stay private.
export const publicProductFields =
  '_id product_name slug sku price discount category categories brand description model_year thumbnail images.secure_url sourceImages stock is_active on_sale count_view is_best_seller is_new is_hot is_home variants._id variants.sku variants.variant_name variants.color variants.size variants.price variants.compare_at_price variants.stock variants.image variants.images variants.attributes tags weight dimensions warrantyInformation shippingInformation returnPolicy minimumOrderQuantity currency';
const references = [
  { path: 'category', select: '_id name' },
  {
    path: 'categories',
    select: '_id name',
    match: { isActive: true, isDeleted: { $ne: true } },
  },
  { path: 'brand', select: '_id name' },
];

// Lists do not render editorial content. Exclude it in MongoDB, before loading
// documents into memory; detail reads and internal indexing retain full content.
export const publicProductListFields = publicProductFields
  .split(' ')
  .filter((field) =>
    !['description', 'warrantyInformation', 'shippingInformation', 'returnPolicy'].includes(field)
  )
  .join(' ');

export async function visibleCatalogFilter(
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const active = { isActive: true, isDeleted: { $ne: true } };
  const categoryQuery = Categories.distinct('_id', active);
  const brandQuery = BrandModel.distinct('_id', active);
  if (signal) {
    signal.throwIfAborted();
    categoryQuery.setOptions({ signal, maxTimeMS: 5000 });
    brandQuery.setOptions({ signal, maxTimeMS: 5000 });
  }
  const [categories, brands] = await Promise.all([categoryQuery, brandQuery]);
  return {
    on_sale: { $ne: false },
    category: { $in: categories },
    brand: { $in: brands },
  };
}

export async function listStoreProducts(
  filters: Partial<GetProductsQuery>,
  signal?: AbortSignal,
  options: { includeContent?: boolean } = {}
) {
  signal?.throwIfAborted();
  if (filters.category) {
    filters = {
      ...filters,
      category: (await expandPublicCategoryFilter(filters.category, signal))!,
    };
  }
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 12;
  const query: Record<string, unknown> = {
    $and: [
      await buildProductSearchQuery(filters, true, signal),
      await visibleCatalogFilter(signal),
    ],
    is_active: true,
  };
  const priceIds =
    filters.sortBy === 'price'
      ? await discountedPricePageIds(query, filters, page, limit, signal)
      : null;
  const populate = signal
    ? references.map((reference) => ({
        ...reference,
        options: { signal, maxTimeMS: 5000 },
      }))
    : references;
  const fields = options.includeContent
    ? publicProductFields
    : publicProductListFields;
  const dataQuery = priceIds
    ? Product.find({ $and: [query, { _id: { $in: priceIds } }] })
        .select(fields)
        .populate(populate)
        .lean()
    : Product.find(query)
        .select(fields)
        .populate(populate)
        .sort(buildProductSort(filters))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
  const totalQuery = Product.countDocuments(query);
  if (signal) {
    signal.throwIfAborted();
    dataQuery.setOptions({ signal, maxTimeMS: 5000 });
    totalQuery.setOptions({ signal, maxTimeMS: 5000 });
  }
  const [data, total] = await Promise.all([dataQuery, totalQuery]);
  signal?.throwIfAborted();
  if (priceIds) {
    const positions = new Map(priceIds.map((id, index) => [String(id), index]));
    data.sort(
      (a, b) => positions.get(String(a._id))! - positions.get(String(b._id))!
    );
  }
  return { data, pagination: buildPagination(page, limit, total) };
}

export async function getStoreProduct(slug: string) {
  return Product.findOne({
    slug,
    is_active: true,
    ...(await visibleCatalogFilter()),
  })
    .select(publicProductFields)
    .populate(references)
    .lean();
}

export async function relatedStoreProducts(product: {
  _id: unknown;
  category: unknown;
  categories?: unknown[] | null;
  tags?: string[];
}) {
  const category =
    product.category &&
    typeof product.category === 'object' &&
    '_id' in product.category
      ? product.category._id
      : product.category;
  const query: Record<string, unknown> = {
    _id: { $ne: product._id },
    is_active: true,
    $and: [
      await visibleCatalogFilter(),
      categoryMembership([
        category,
        ...(product.categories ?? []).map((value) =>
          value && typeof value === 'object' && '_id' in value
            ? value._id
            : value
        ),
      ]),
    ],
  };
  return Product.find(query)
    .select(publicProductListFields)
    .populate(references)
    .sort({ createdAt: -1, _id: -1 })
    .limit(5)
    .lean();
}

// Atomic counter writes deliberately leave metadata/inventory __v and updatedAt unchanged.
export async function recordStoreProductView(slug: string) {
  return Product.findOneAndUpdate(
    { slug, is_active: true, ...(await visibleCatalogFilter()) },
    { $inc: { count_view: 1 } },
    { returnDocument: 'after', timestamps: false }
  )
    .select('count_view -_id')
    .lean();
}
