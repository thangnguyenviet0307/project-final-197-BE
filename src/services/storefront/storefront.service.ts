import { Types } from 'mongoose';
import Product from '../../models/products/products.model.js';
import { calculateOrderTotal } from '../../utils/orders/order-total.js';
import { getProductMetrics } from '../products/product-reviews.service.js';

interface PublicReference {
  _id: Types.ObjectId;
  name: string;
  slug: string;
}
const activeReference = { isActive: true, isDeleted: { $ne: true } };
const unitPrice = (price: number, discount: number) =>
  calculateOrderTotal([{ price, discount, quantity: 1 }]);

const storefrontFields =
  'on_sale product_name slug description model_year thumbnail images price discount stock variants category brand sku barcode currency tags weight dimensions warrantyInformation shippingInformation returnPolicy minimumOrderQuantity';
async function readStorefrontProduct(slug: string) {
  return Product.findOne({
    slug,
    is_active: true,
    on_sale: { $ne: false },
  })
    .select(storefrontFields)
    .populate<{ category: PublicReference | null }>({
      path: 'category',
      select: 'name slug',
      match: activeReference,
    })
    .populate<{ brand: PublicReference | null }>({
      path: 'brand',
      select: 'name slug',
      match: activeReference,
    })
    .lean();
}
function mapStorefrontProduct(
  product: Awaited<ReturnType<typeof readStorefrontProduct>>
) {
  if (!product || !product.category || !product.brand) return null;
  const discount = product.discount ?? 0;
  const variants = product.variants.map((variant) => ({
    id: String(variant._id),
    sku: variant.sku,
    name:
      variant.variant_name ||
      [variant.color, variant.size].filter(Boolean).join(' / ') ||
      variant.sku,
    color: variant.color ?? null,
    size: variant.size ?? null,
    price: unitPrice(variant.price, discount),
    compareAtPrice: Math.max(variant.compare_at_price ?? 0, variant.price),
    available: product.on_sale !== false && variant.stock > 0,
    image: variant.image ?? null,
    images: variant.images ?? [],
  }));
  const cheapest = variants.reduce<(typeof variants)[number] | undefined>(
    (current, variant) =>
      !current || variant.price < current.price ? variant : current,
    undefined
  );
  return {
    sku: product.sku ?? null,
    barcode: product.barcode ?? null,
    currency: product.currency ?? 'VND',
    tags: product.tags ?? [],
    weight: product.weight ?? null,
    weightUnit: 'kg',
    dimensions: product.dimensions ?? null,
    dimensionUnit: 'cm',
    warrantyInformation: product.warrantyInformation ?? null,
    shippingInformation: product.shippingInformation ?? null,
    returnPolicy: product.returnPolicy ?? null,
    minimumOrderQuantity: product.minimumOrderQuantity ?? 1,
    id: String(product._id),
    slug: product.slug,
    name: product.product_name,
    description: product.description ?? '',
    modelYear: product.model_year ?? null,
    category: {
      id: String(product.category._id),
      name: product.category.name,
      slug: product.category.slug,
    },
    brand: {
      id: String(product.brand._id),
      name: product.brand.name,
      slug: product.brand.slug,
    },
    price: cheapest?.price ?? unitPrice(product.price, discount),
    compareAtPrice: cheapest?.compareAtPrice ?? product.price,
    available:
      product.on_sale !== false &&
      (variants.length
        ? variants.some((variant) => variant.available)
        : product.stock > 0),
    thumbnail: product.thumbnail ?? null,
    images: product.images.map((image) => image.secure_url),
    variants,
  };
}
export async function getStorefrontProduct(slug: string) {
  const product = mapStorefrontProduct(await readStorefrontProduct(slug));
  if (!product) return null;
  return { ...(await getProductMetrics(product.id)), ...product };
}
// Batch public DTOs reuse the same prices/variants without per-product review/order queries.
async function readStorefrontProducts(
  filter: { slug?: { $in: string[] }; _id?: { $in: string[] } },
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const options = { maxTimeMS: 5000, ...(signal ? { signal } : {}) };
  const rows = await Product.find({
    ...filter,
    is_active: true,
    on_sale: { $ne: false },
  })
    .setOptions(options)
    .select(storefrontFields)
    .populate<{ category: PublicReference | null }>({
      path: 'category',
      select: 'name slug',
      match: activeReference,
      options,
    })
    .populate<{ brand: PublicReference | null }>({
      path: 'brand',
      select: 'name slug',
      match: activeReference,
      options,
    })
    .lean();
  signal?.throwIfAborted();
  return rows
    .map(mapStorefrontProduct)
    .filter((p): p is NonNullable<typeof p> => !!p);
}
export async function getStorefrontProducts(
  slugs: string[],
  signal?: AbortSignal
) {
  if (!slugs.length) return [];
  return readStorefrontProducts({ slug: { $in: slugs } }, signal);
}
export async function getStorefrontProductsByIds(
  ids: string[],
  signal?: AbortSignal
) {
  if (!ids.length) return [];
  return readStorefrontProducts({ _id: { $in: ids } }, signal);
}

export async function getStorefrontRecommendations(excludeSlug: string) {
  const rows = await Product.find({
    is_active: true,
    on_sale: { $ne: false },
    slug: { $ne: excludeSlug },
  })
    .select('slug')
    .sort({ createdAt: -1, _id: -1 })
    .limit(12)
    .lean();
  const products = await Promise.all(
    rows.map((row) => getStorefrontProduct(row.slug))
  );
  return products.filter(
    (product): product is NonNullable<typeof product> => product !== null
  );
}
