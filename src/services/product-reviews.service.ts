import { Types } from "mongoose";
import createHttpError from "http-errors";
import { z } from "zod";
import Product from "../models/products.model.js";
import { ProductReview } from "../models/product-reviews.model.js";
import { Order } from "../models/orders.model.js";
import { OrderStatus } from "../types/orders.type.js";
import { reviewInputSchema } from "../validations/products.validation.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { buildPagination } from "../utils/pagination.js";

export async function getProductMetrics(productId: string) {
  const id = new Types.ObjectId(productId);
  const [reviews, sales] = await Promise.all([
    ProductReview.aggregate<{ rating: number; reviewCount: number }>([
      { $match: { product: id } }, { $group: { _id: null, rating: { $avg: "$rating" }, reviewCount: { $sum: 1 } } },
    ]),
    Order.aggregate<{ soldCount: number }>([
      { $match: { orderStatus: OrderStatus.Completed, "orderItems.productId": id } },
      { $unwind: "$orderItems" }, { $match: { "orderItems.productId": id } },
      { $group: { _id: null, soldCount: { $sum: "$orderItems.quantity" } } },
    ]),
  ]);
  return { rating: Math.round((reviews[0]?.rating ?? 0) * 10) / 10, reviewCount: reviews[0]?.reviewCount ?? 0, soldCount: sales[0]?.soldCount ?? 0 };
}

export async function listProductReviews(product: string, page: number, limit: number) {
  const [data, total] = await Promise.all([
    ProductReview.find({ product }).sort({ date: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ProductReview.countDocuments({ product }),
  ]);
  return { data, pagination: buildPagination(page, limit, total) };
}

export async function addProductReview(product: string, input: z.infer<typeof reviewInputSchema>) {
  return withRelationsTransaction(async session => {
    if (!(await Product.exists({ _id: product }).session(session))) throw createHttpError(404, "Product not found");
    const review = new ProductReview({ ...input, product, source: "admin" });
    await review.save({ session });
    return review.toObject();
  });
}

export async function deleteProductReview(product: string, id: string) {
  const review = await ProductReview.findOneAndDelete({ _id: id, product });
  if (!review) throw createHttpError(404, "Review not found");
}
