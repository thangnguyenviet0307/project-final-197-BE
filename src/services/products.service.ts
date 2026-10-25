import { OPEN_ORDER_STATUSES } from "../types/orders.type.js";
import { sumVariantStock } from "../utils/inventory.js";
import { buildPagination } from "../utils/pagination.js";
import createHttpError from "http-errors";
import { Order } from "../models/orders.model.js";
import { escapeRegex } from "../utils/search.js";
import Product from "../models/products.model.js";
import { buildSlug } from "../helpers/buildSlug.helper.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { assertActiveCatalog } from "../utils/catalog-reference.js";

import type { ProductVariantInput, ProductInput, UpdateProductInput, GetProductsQuery } from "../types/products.type.js";
export type { ProductVariantInput, ProductInput } from "../types/products.type.js";

const normalizeVariant = (
  variant: ProductVariantInput,
  fallbackPrice: number,
): ProductVariantInput => {
  const images = Array.isArray(variant.images)
    ? variant.images.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const image = variant.image?.trim() || images[0] || null;

  return {
    ...(variant._id ? { _id: variant._id } : {}),
    sku: String(variant.sku ?? "")
      .trim()
      .toUpperCase(),
    variant_name: variant.variant_name?.trim() || null,
    color: variant.color?.trim() || null,
    size: variant.size?.trim() || null,
    price: Number(variant.price ?? fallbackPrice ?? 0),
    compare_at_price:
      variant.compare_at_price != null
        ? Number(variant.compare_at_price)
        : null,
    stock: Number(variant.stock ?? 0),
    image,
    images: images.length ? images : image ? [image] : [],
    attributes: variant.attributes ?? {},
  };
};

const normalizeVariants = (
  variants: ProductVariantInput[] | undefined,
  fallbackPrice?: number,
): ProductVariantInput[] => {
  if (!Array.isArray(variants) || variants.length === 0) {
    return [];
  }

  return variants.map((variant) =>
    normalizeVariant(variant, fallbackPrice ?? 0),
  );
};

const ensureUniqueVariantSkus = async (
  variants: ProductVariantInput[],
  excludeId?: string,
): Promise<void> => {
  const seen = new Set<string>();
  const ids = new Set<string>();

  for (const variant of variants) {
    if (variant._id) {
      const key = variant._id.toLowerCase();
      if (ids.has(key)) throw createHttpError(400, "Duplicate variant ID");
      ids.add(key);
    }
    const { sku } = variant;

    if (!sku) {
      throw createHttpError(400, "Mỗi biến thể phải có SKU");
    }

    if (seen.has(sku)) {
      throw createHttpError(409, `SKU ${sku} bị trùng lặp trong cùng một sản phẩm`);
    }

    seen.add(sku);

    const exists = await Product.exists({
      "variants.sku": sku,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });

    if (exists) {
      throw createHttpError(409, `SKU ${sku} đã tồn tại trên sản phẩm khác`);
    }
  }
};

const getAllProducts = async (
  filters: Partial<GetProductsQuery> = {},
) => {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 10;
  const variants: Record<string, unknown> = {};
  if (filters.sku) variants["sku"] = filters.sku.trim().toUpperCase();
  if (filters.color) variants["color"] = { $regex: escapeRegex(filters.color.trim()), $options: "i" };
  if (filters.size) variants["size"] = { $regex: escapeRegex(filters.size.trim()), $options: "i" };
  const query = Object.keys(variants).length ? { variants: { $elemMatch: variants } } : {};
  const [data, total] = await Promise.all([
    Product.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("brand category").lean(),
    Product.countDocuments(query),
  ]);
  return { data, pagination: buildPagination(page, limit, total) };
};

const getProductBySku = async (sku: string) => {
  const normalizedSku = String(sku).trim().toUpperCase();

  return Product.findOne({ "variants.sku": normalizedSku })
    .populate("brand category")
    .lean();
};

const getVariantByProductAndVariantId = async (
  productId: string,
  variantId: string,
) => {
  const product = await Product.findById(productId)
    .populate("brand category")
    .lean();

  if (!product || !Array.isArray(product.variants)) {
    return null;
  }

  const variant = product.variants.find(
    (item) => String(item._id) === String(variantId),
  );

  if (!variant) {
    return null;
  }

  return { product, variant };
};

const getProductById = async (id: string) => {
  return Product.findById(id).populate("brand category").lean();
};

async function findAvailableProductSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  while (await Product.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = baseSlug + "-" + counter++;
  }
  return slug;
}

function lowestVariantPrice(variants: ProductVariantInput[]): number | undefined {
  return variants.length ? Math.min(...variants.map(variant => variant.price)) : undefined;
}

const createProduct = async (payload: ProductInput) => withRelationsTransaction(async (session) => {
  await assertActiveCatalog(payload.brand, payload.category, session);
  const name = payload.product_name?.trim();

  if (!name) {
    throw createHttpError(400, "Tên sản phẩm là bắt buộc");
  }

  const slug = await findAvailableProductSlug(payload.slug?.trim() || buildSlug(name));

  const normalizedVariants = normalizeVariants(
    payload.variants,
    payload.price ?? 0,
  );

  await ensureUniqueVariantSkus(normalizedVariants);

  const computedPrice = payload.price ?? lowestVariantPrice(normalizedVariants) ?? 0;

  const computedStock = normalizedVariants.length
    ? sumVariantStock(normalizedVariants)
    : Number(payload.stock ?? 0);

  const thumbnail =
    payload.thumbnail?.trim() ||
    normalizedVariants.find((variant) => Boolean(variant.image))?.image ||
    null;

  const product = new Product({
    ...payload,
    product_name: name,
    slug,
    price: computedPrice,
    stock: computedStock,
    thumbnail,
    variants: normalizedVariants,
  });
  await product.save({ session });

  return product.toObject();
});

const updateProduct = async (
  id: string,
  payload: UpdateProductInput,
) => withRelationsTransaction(async (session) => {
  const existing = await Product.findById(id).session(session);

  if (!existing) return null;
  if (payload.brand || payload.category || payload.is_active === true) {
    await assertActiveCatalog(payload.brand ?? existing.brand, payload.category ?? existing.category, session);
  }

  const nextName = payload.product_name?.trim();

  const updated: UpdateProductInput = {
    ...payload,
  };

  if (nextName) {
    updated.product_name = nextName;
    updated.slug = await findAvailableProductSlug(payload.slug?.trim() || buildSlug(nextName), id);
  }

  if (Array.isArray(payload.variants)) {
    const variants = payload.variants.map((variant) => {
      if (!variant._id) return variant;
      const previous = existing.variants.id(variant._id);
      if (!previous) throw createHttpError(400, "Variant ID does not belong to this product");
      return { ...previous.toObject(), ...variant, _id: String(previous._id) };
    });
    const normalizedVariants = normalizeVariants(
      variants,
      payload.price ?? existing.price ?? 0,
    );
    await ensureUniqueVariantSkus(normalizedVariants, id);

    updated.variants = normalizedVariants;
    if (payload.price == null && normalizedVariants.length > 0) {
      updated.price = lowestVariantPrice(normalizedVariants) ?? 0;
    }

    updated.stock = normalizedVariants.length ? sumVariantStock(normalizedVariants) : payload.stock ?? existing.stock;

    if (!payload.thumbnail && normalizedVariants.length > 0) {
      const firstVariantImage = normalizedVariants.find((variant) =>
        Boolean(variant.image),
      )?.image;
      if (firstVariantImage) {
        updated.thumbnail = firstVariantImage;
      }
    }
  }

  if (Array.isArray(payload.variants)) {
    if (payload.variants.length && await Order.exists({ orderStatus: { $in: OPEN_ORDER_STATUSES },
      orderItems: { $elemMatch: { productId: id, variantId: { $exists: false } } } })) {
      throw createHttpError(409, "Complete legacy product orders before adding variants");
    }
    const retained = new Set(payload.variants.map((variant) => variant._id).filter(Boolean));
    const removed = existing.variants.filter((variant) => !retained.has(String(variant._id)));
    if (removed.length && await Order.exists({ orderStatus: { $in: OPEN_ORDER_STATUSES },
      orderItems: { $elemMatch: { productId: id, variantId: { $in: removed.map((variant) => variant._id) } } } })) {
      throw createHttpError(409, "Cannot remove variants reserved by open orders");
    }
  } else if (existing.variants.length && payload.stock !== undefined) {
    throw createHttpError(400, "Update stock on individual variants");
  }
  existing.set(updated);
  await existing.save({ session });
  return existing.toObject();
});

const deleteProduct = async (id: string) => withRelationsTransaction(async (session) => {
  if (await Order.exists({ "orderItems.productId": id }).session(session)) {
    throw createHttpError(409, "Cannot delete products referenced by orders");
  }
  const product = await Product.findByIdAndDelete(id, { session });
  return product ? product.toObject() : null;
});

export default {
  getAllProducts,
  getProductBySku,
  getVariantByProductAndVariantId,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
