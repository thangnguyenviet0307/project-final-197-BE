import { Types } from "mongoose";
import createHttpError from "http-errors";
import { z } from "zod";
import Product from "../models/products.model.js";
import { ProductReview } from "../models/product-reviews.model.js";
import { Order } from "../models/orders.model.js";
import { OrderStatus } from "../types/orders.type.js";
import { reviewInputSchema, storeReviewInputSchema } from "../validations/products.validation.js";
import { assertActiveCatalog } from "../utils/catalog-reference.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { buildPagination } from "../utils/pagination.js";

export async function getProductMetrics(productId: string, includeDistribution = false) {
  const id = new Types.ObjectId(productId);
  const [reviews, sales] = await Promise.all([
    ProductReview.aggregate<{ rating: number; reviewCount: number; star1?: number; star2?: number; star3?: number; star4?: number; star5?: number }>([
      { $match: { product: id } }, { $group: { _id: null, rating: { $avg: "$rating" }, reviewCount: { $sum: 1 },
        ...(includeDistribution ? Object.fromEntries([1, 2, 3, 4, 5].map(star => [`star${star}`, { $sum: { $cond: [{ $eq: ["$rating", star] }, 1, 0] } }])) : {}),
      } },
    ]),
    Order.aggregate<{ soldCount: number }>([
      { $match: { orderStatus: OrderStatus.Completed, "orderItems.productId": id } },
      { $unwind: "$orderItems" }, { $match: { "orderItems.productId": id } },
      { $group: { _id: null, soldCount: { $sum: "$orderItems.quantity" } } },
    ]),
  ]);
  const review = reviews[0];
  return { rating: Math.round((review?.rating ?? 0) * 10) / 10, reviewCount: review?.reviewCount ?? 0, soldCount: sales[0]?.soldCount ?? 0,
    ...(includeDistribution ? { ratingDistribution: { 1: review?.star1 ?? 0, 2: review?.star2 ?? 0, 3: review?.star3 ?? 0, 4: review?.star4 ?? 0, 5: review?.star5 ?? 0 } } : {}),
  };
}

export async function listProductReviews(product: string, page: number, limit: number) {
  const [data, total] = await Promise.all([
    ProductReview.find({ product }).sort({ date: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ProductReview.countDocuments({ product }),
  ]);
  return { data, pagination: buildPagination(page, limit, total) };
}

export async function addProductReview(product: string, input: z.infer<typeof reviewInputSchema>) {
  return saveReview(product, input, "admin");
}

export async function addStoreProductReview(product: string, input: z.infer<typeof storeReviewInputSchema>) {
  return saveReview(product, input, "storefront");
}

async function saveReview(product: string, input: z.infer<typeof storeReviewInputSchema>, source: "admin" | "storefront") {
  return withRelationsTransaction(async session => {
    if (source === "storefront") {
      const current = await Product.findOne({ _id: product, is_active: true, on_sale: { $ne: false } }).session(session);
      if (!current) throw createHttpError(404, "Product not found");
      await assertActiveCatalog(String(current.brand), String(current.category), session);
    } else if (!(await Product.exists({ _id: product }).session(session))) throw createHttpError(404, "Product not found");
    const review = new ProductReview({ ...input, product, source });
    await review.save({ session });
    return review.toObject();
  });
}

export async function deleteProductReview(product: string, id: string) {
  const review = await ProductReview.findOneAndDelete({ _id: id, product });
  if (!review) throw createHttpError(404, "Review not found");
}
