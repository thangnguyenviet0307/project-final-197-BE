import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import { assertFound } from "../utils/assert-found.js";
import {
  recordStoreProductView,
  listStoreProducts,
  getStoreProduct,
  relatedStoreProducts,
} from "../services/store-products.service.js";
import {
  getProductMetrics,
  listProductReviews,
  addStoreProductReview,
} from "../services/product-reviews.service.js";
import type { GetProductsQuery } from "../types/products.type.js";
import type { RequestHandler } from "express";

export const storeProducts: RequestHandler = asyncHandler(async (req, res) => {
  return sendResponse(
    res,
    200,
    await listStoreProducts(req.query as unknown as GetProductsQuery),
  );
});
export const storeProduct: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getStoreProduct(req.params["slug"] as string);
  assertFound(product, "Không tìm thấy sản phẩm");
  return sendResponse(res, 200, { data: product });
});

export const storeMetrics: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getStoreProduct(req.params["slug"] as string);
  assertFound(product, "Không tìm thấy sản phẩm");
  return sendResponse(res, 200, {
    data: await getProductMetrics(String(product._id), true),
  });
});
export const storeReviews: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getStoreProduct(req.params["slug"] as string);
  assertFound(product, "Không tìm thấy sản phẩm");
  const { page, limit } = req.query as unknown as {
    page: number;
    limit: number;
  };
  const result = await listProductReviews(String(product._id), page, limit);
  return sendResponse(res, 200, {
    ...result,
    data: result.data.map((review) => ({
      rating: review.rating,
      comment: review.comment,
      reviewerName: review.reviewerName,
      date: review.date,
      source: review.source,
    })),
  });
});
export const storeRelated: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getStoreProduct(req.params["slug"] as string);
  assertFound(product, "Không tìm thấy sản phẩm");
  return sendResponse(res, 200, { data: await relatedStoreProducts(product) });
});

export const createStoreReview: RequestHandler = asyncHandler(
  async (req, res) => {
    const product = await getStoreProduct(req.params["slug"] as string);
    assertFound(product, "Không tìm thấy sản phẩm");
    const review = await addStoreProductReview(String(product._id), req.body);
    return sendResponse(res, 201, {
      data: {
        rating: review.rating,
        comment: review.comment,
        reviewerName: review.reviewerName,
        date: review.date,
        source: review.source,
      },
    });
  },
);

export const storeProductView: RequestHandler = asyncHandler(
  async (req, res) => {
    const product = await recordStoreProductView(req.params["slug"] as string);
    assertFound(product, "Không tìm thấy sản phẩm");
    res.setHeader("Cache-Control", "no-store");
    return sendResponse(res, 200, { data: { count_view: product.count_view } });
  },
);
