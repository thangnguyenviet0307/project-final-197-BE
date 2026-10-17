import { buildPagination } from "../utils/pagination.js";
import mongoose from "mongoose";
import createHttpError from "http-errors";
import { Order } from "../models/order.model.js";
import { escapeRegex } from "../utils/search.js";
import Product from "../models/product.model.js";
import { buildSlug } from "../helpers/buildSlug.helper.js";

export type ProductVariantInput = {
  _id?: string;
  sku: string;
  variant_name?: string | null;
  color?: string | null;
  size?: string | null;
  price?: number;
  compare_at_price?: number | null;
  stock?: number;
  image?: string | null;
  images?: string[];
  attributes?: Record<string, string | number | boolean | null>;
};

export type ProductInput = {
  product_name: string;
  price?: number;
  discount?: number;
  category: string;
  brand: string;
  description?: string | null;
  model_year: number;
  slug?: string;
  thumbnail?: string | null;
  stock?: number;
  is_active?: boolean;
  variants?: ProductVariantInput[];
};

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

  for (const variant of variants) {
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
  filters: { page?: number; limit?: number; sku?: string | undefined;
    color?: string | undefined; size?: string | undefined } = {},
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

const createProduct = async (payload: ProductInput) => {
  const name = payload.product_name?.trim();

  if (!name) {
    throw createHttpError(400, "Tên sản phẩm là bắt buộc");
  }

  const baseSlug = payload.slug?.trim() || buildSlug(name);
  let slug = baseSlug;
  let counter = 1;

  while (await Product.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const normalizedVariants = normalizeVariants(
    payload.variants,
    payload.price ?? 0,
  );

  await ensureUniqueVariantSkus(normalizedVariants);

  const variantPriceList = normalizedVariants.map((variant) =>
    Number(variant.price ?? 0),
  );
  const computedPrice =
    payload.price != null
      ? Number(payload.price)
      : variantPriceList.length > 0
        ? Math.min(...variantPriceList)
        : 0;

  const computedStock = normalizedVariants.length
    ? normalizedVariants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0)
    : Number(payload.stock ?? 0);

  const thumbnail =
    payload.thumbnail?.trim() ||
    normalizedVariants.find((variant) => Boolean(variant.image))?.image ||
    null;

  const product = await Product.create({
    ...payload,
    product_name: name,
    slug,
    price: computedPrice,
    stock: computedStock,
    thumbnail,
    variants: normalizedVariants,
  });

  return product.toObject();
};

const updateProduct = async (
  id: string,
  payload: Partial<ProductInput>,
) => {
  const existing = await Product.findById(id);

  if (!existing) return null;

  const nextName = payload.product_name?.trim();

  const updated: Partial<ProductInput> & { slug?: string } = {
    ...payload,
  };

  if (nextName) {
    updated.product_name = nextName;
    const baseSlug = payload.slug?.trim() || buildSlug(nextName);
    let slug = baseSlug;
    let counter = 1;

    while (await Product.exists({ slug, _id: { $ne: id } })) {
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }

    updated.slug = slug;
  }

  if (Array.isArray(payload.variants)) {
    const normalizedVariants = normalizeVariants(
      payload.variants,
      payload.price ?? existing.price ?? 0,
    );
    await ensureUniqueVariantSkus(normalizedVariants, id);

    updated.variants = normalizedVariants;
    const variantPriceList = normalizedVariants.map((variant) =>
      Number(variant.price ?? 0),
    );
    if (payload.price == null && variantPriceList.length > 0) {
      updated.price = Math.min(...variantPriceList);
    }

    updated.stock = normalizedVariants.reduce(
        (sum, variant) => sum + Number(variant.stock ?? 0),
        0,
      );

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
    if (payload.variants.length && await Order.exists({ orderStatus: { $in: [1, 2] },
      orderItems: { $elemMatch: { productId: id, variantId: { $exists: false } } } })) {
      throw createHttpError(409, "Complete legacy product orders before adding variants");
    }
    const retained = new Set(payload.variants.map((variant) => variant._id).filter(Boolean));
    const removed = existing.variants.filter((variant) => !retained.has(String(variant._id)));
    if (removed.length && await Order.exists({ orderStatus: { $in: [1, 2] },
      orderItems: { $elemMatch: { productId: id, variantId: { $in: removed.map((variant) => variant._id) } } } })) {
      throw createHttpError(409, "Cannot remove variants reserved by open orders");
    }
  } else if (existing.variants.length && payload.stock !== undefined) {
    throw createHttpError(400, "Update stock on individual variants");
  }
  existing.set(updated);
  await existing.save();
  return existing.toObject();
};

const deleteProduct = async (id: string) => mongoose.connection.transaction(async (session) => {
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
