import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { assertFound } from "../utils/assert-found.js";
import { sendResponse } from "../helpers/response.helper.js";
import { getStorefrontProduct, getStorefrontRecommendations } from "../services/storefront.service.js";

export const getProductBySlug: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getStorefrontProduct(String(req.params["slug"]));
  assertFound(product, "Product not found");
  sendResponse(res, 200, { data: product });
});

export const getRecommendations: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await getStorefrontRecommendations(String(req.params["slug"])) });
});
