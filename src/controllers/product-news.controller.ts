import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import * as service from "../services/product-news.service.js";
import { productNewsSchema } from "../validations/product-news.validation.js";
import type { RequestHandler } from "express";

export const getProductNews: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.getProductNews(String(req.params["id"])) });
});
export const updateProductNews: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.updateProductNews(String(req.params["id"]), productNewsSchema.parse(req.body)) });
});
export const publicProductNews: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.publicProductNews(String(req.params["slug"])) });
});
