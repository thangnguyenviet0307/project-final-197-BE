import { Types } from "mongoose";
import Product from "../models/products.model.js";
import { calculateOrderTotal } from "../utils/order-total.js";

interface PublicReference { _id: Types.ObjectId; name: string; slug: string }
const activeReference = { isActive: true, isDeleted: { $ne: true } };
const unitPrice = (price: number, discount: number) => calculateOrderTotal([{ price, discount, quantity: 1 }]);

export async function getStorefrontProduct(slug: string) {
  const product = await Product.findOne({ slug, is_active: true })
    .select("product_name slug description model_year thumbnail images price discount stock variants category brand")
    .populate<{ category: PublicReference | null }>({ path: "category", select: "name slug", match: activeReference })
    .populate<{ brand: PublicReference | null }>({ path: "brand", select: "name slug", match: activeReference })
    .lean();
  if (!product || !product.category || !product.brand) return null;
  const discount = product.discount ?? 0;
  const variants = product.variants.map(variant => ({
    id: String(variant._id), sku: variant.sku,
    name: variant.variant_name || [variant.color, variant.size].filter(Boolean).join(" / ") || variant.sku,
    color: variant.color ?? null, size: variant.size ?? null,
    price: unitPrice(variant.price, discount),
    compareAtPrice: Math.max(variant.compare_at_price ?? 0, variant.price),
    available: variant.stock > 0,
    image: variant.image ?? null, images: variant.images ?? [],
  }));
  const cheapest = variants.length ? Math.min(...variants.map(variant => variant.price)) : unitPrice(product.price, discount);
  return {
    id: String(product._id), slug: product.slug, name: product.product_name,
    description: product.description ?? "", modelYear: product.model_year,
    category: { id: String(product.category._id), name: product.category.name, slug: product.category.slug },
    brand: { id: String(product.brand._id), name: product.brand.name, slug: product.brand.slug },
    price: cheapest, compareAtPrice: variants.length ? cheapest : product.price,
    available: variants.length ? variants.some(variant => variant.available) : product.stock > 0,
    thumbnail: product.thumbnail ?? null,
    images: product.images.map(image => image.secure_url), variants,
  };
}

export async function getStorefrontRecommendations(excludeSlug: string) {
  const rows = await Product.find({ is_active: true, slug: { $ne: excludeSlug } }).select("slug").sort({ createdAt: -1, _id: -1 }).limit(12).lean();
  const products = await Promise.all(rows.map(row => getStorefrontProduct(row.slug)));
  return products.filter((product): product is NonNullable<typeof product> => product !== null);
}
