import { listProductReviews } from "../services/product-reviews.service.js";
import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { assertFound } from "../utils/assert-found.js";
import { sendResponse } from "../helpers/response.helper.js";
import { getStorefrontProduct, getStorefrontRecommendations } from "../services/storefront.service.js";
import { aboutPageContent, faqPageContent } from "../services/storefront-content.service.js";

export const getAboutPageContent: RequestHandler = (_req, res) => {
  sendResponse(res, 200, { data: aboutPageContent });
};

export const getFAQPageContent: RequestHandler = (_req, res) => {
  sendResponse(res, 200, { data: faqPageContent });
};

export const getProductBySlug: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getStorefrontProduct(String(req.params["slug"]));
  assertFound(product, "Product not found");
  sendResponse(res, 200, { data: product });
});

export const getRecommendations: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await getStorefrontRecommendations(String(req.params["slug"])) });
});

export const publicProductReviews: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getStorefrontProduct(req.params['slug'] as string);
  assertFound(product, "Product not found");
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  const result = await listProductReviews(product.id, page, limit);
  sendResponse(res, 200, { ...result, data: result.data.map(review => ({
    rating: review.rating, comment: review.comment, reviewerName: review.reviewerName, date: review.date, source: review.source,
  })) });
});
