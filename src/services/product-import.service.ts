import createHttpError from "http-errors";
import { Categories } from "../models/categories.model.js";
import { BrandModel } from "../models/brands.model.js";
import Product from "../models/products.model.js";
import { ProductReview } from "../models/product-reviews.model.js";
import { buildSlug } from "../helpers/buildSlug.helper.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { createProductInSession } from "./products.service.js";
import type { ImportDummyProductInput } from "../validations/products.validation.js";

// Pure mapping: no implicit exchange rate, unit conversion, or fabricated model year.
export function mapDummyProduct(input: ImportDummyProductInput, category: string, brand: string) {
  const { product: p } = input;
  const price = Math.round(p.price * input.exchangeRate);
  if (!Number.isSafeInteger(price)) throw createHttpError(400, "Converted price exceeds supported range");
  return {
    product_name: p.title, description: p.description, price, discount: p.discountPercentage,
    category, brand, sku: p.sku, stock: p.stock, tags: p.tags,
    weight: p.weight, dimensions: p.dimensions, currency: "VND" as const,
    warrantyInformation: p.warrantyInformation, shippingInformation: p.shippingInformation,
    returnPolicy: p.returnPolicy, minimumOrderQuantity: p.minimumOrderQuantity,
    barcode: p.meta?.barcode, source: "dummyjson" as const, external_id: String(p.id),
    sourceCurrency: input.sourceCurrency, importExchangeRate: input.exchangeRate,
    sourceCreatedAt: p.meta?.createdAt ? new Date(p.meta.createdAt) : undefined,
    sourceUpdatedAt: p.meta?.updatedAt ? new Date(p.meta.updatedAt) : undefined,
    sourceImages: [...new Set([...(p.thumbnail ? [p.thumbnail] : []), ...p.images])],
    // Uploaded gallery and thumbnail are populated only by the existing upload endpoint.
    is_active: false,
  };
}

export async function importDummyProduct(input: ImportDummyProductInput) {
  return withRelationsTransaction(async session => {
    if (await Product.exists({ source: "dummyjson", external_id: String(input.product.id) }).session(session)) {
      throw createHttpError(409, "Source product already imported; review the existing product before updating");
    }
    const active = { isActive: true, isDeleted: { $ne: true } };
    const category = await Categories.findOne({ ...active, ...(input.categoryId ? { _id: input.categoryId } : { slug: buildSlug(input.product.category) }) }).session(session);
    const brand = await BrandModel.findOne({ ...active, ...(input.brandId ? { _id: input.brandId } : { slug: buildSlug(input.product.brand) }) }).session(session);
    if (!category || !brand) throw createHttpError(400, "Create active category/brand first or supply matching categoryId/brandId");
    const product = await createProductInSession(mapDummyProduct(input, String(category._id), String(brand._id)), session);
    if (input.product.reviews.length) await ProductReview.insertMany(input.product.reviews.map(review => ({
      ...review, product: product._id, source: "dummyjson", date: review.date ? new Date(review.date) : new Date(),
    })), { session });
    return product;
  });
}
