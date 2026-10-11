import Product from "../models/product.model.js";
import { buildSlug } from "../helpers/buildSlug.helper.js";

export type ProductVariantInput = {
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
      throw new Error("Mỗi biến thể phải có SKU");
    }

    if (seen.has(sku)) {
      throw new Error(`SKU ${sku} bị trùng lặp trong cùng một sản phẩm`);
    }

    seen.add(sku);

    const exists = await Product.exists({
      "variants.sku": sku,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });

    if (exists) {
      throw new Error(`SKU ${sku} đã tồn tại trên sản phẩm khác`);
    }
  }
};

const getAllProducts = async (
  filters: {
    sku?: string | undefined;
    color?: string | undefined;
    size?: string | undefined;
  } = {},
): Promise<any[]> => {
  const query: Record<string, any> = {};

  if (filters.sku) {
    query["variants.sku"] = String(filters.sku).trim().toUpperCase();
  }

  if (filters.color) {
    query["variants.color"] = {
      $regex: String(filters.color).trim(),
      $options: "i",
    };
  }

  if (filters.size) {
    query["variants.size"] = {
      $regex: String(filters.size).trim(),
      $options: "i",
    };
  }

  return Product.find(query)
    .sort({ createdAt: -1 })
    .populate("brand category")
    .lean();
};

const getProductBySku = async (sku: string): Promise<any | null> => {
  const normalizedSku = String(sku).trim().toUpperCase();

  return Product.findOne({ "variants.sku": normalizedSku })
    .populate("brand category")
    .lean();
};

const getVariantByProductAndVariantId = async (
  productId: string,
  variantId: string,
): Promise<{ product: any; variant: any } | null> => {
  const product = await Product.findById(productId)
    .populate("brand category")
    .lean();

  if (!product || !Array.isArray(product.variants)) {
    return null;
  }

  const variant = product.variants.find(
    (item: any) => String(item._id) === String(variantId),
  );

  if (!variant) {
    return null;
  }

  return { product, variant };
};

const getProductById = async (id: string): Promise<any | null> => {
  return Product.findById(id).populate("brand category").lean();
};

const createProduct = async (payload: ProductInput): Promise<any> => {
  const name = payload.product_name?.trim();

  if (!name) {
    throw new Error("Tên sản phẩm là bắt buộc");
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

  const computedStock =
    payload.stock != null
      ? Number(payload.stock)
      : normalizedVariants.reduce(
          (sum, variant) => sum + Number(variant.stock ?? 0),
          0,
        );

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
): Promise<any | null> => {
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

    if (payload.stock == null && normalizedVariants.length > 0) {
      updated.stock = normalizedVariants.reduce(
        (sum, variant) => sum + Number(variant.stock ?? 0),
        0,
      );
    }

    if (!payload.thumbnail && normalizedVariants.length > 0) {
      const firstVariantImage = normalizedVariants.find((variant) =>
        Boolean(variant.image),
      )?.image;
      if (firstVariantImage) {
        updated.thumbnail = firstVariantImage;
      }
    }
  }

  const product = await Product.findByIdAndUpdate(id, updated, {
    new: true,
    runValidators: true,
  });

  return product ? product.toObject() : null;
};

const deleteProduct = async (id: string): Promise<any | null> => {
  const product = await Product.findByIdAndDelete(id);
  return product ? product.toObject() : null;
};

export default {
  getAllProducts,
  getProductBySku,
  getVariantByProductAndVariantId,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
