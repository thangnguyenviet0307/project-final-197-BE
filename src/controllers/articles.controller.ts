import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import * as service from "../services/articles.service.js";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware.js";
import createHttpError from "http-errors";
import { adminArticleQuerySchema, publicArticleQuerySchema } from "../validations/articles.validation.js";

export const publicArticles: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, await service.listPublicArticles(publicArticleQuerySchema.parse(req.query)));
});

export const publicArticle: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.getPublicArticle(req.params["slug"] as string) });
});

export const recordArticleView: RequestHandler = asyncHandler(async (req, res) => {
  await service.recordArticleView(req.params["slug"] as string);
  sendResponse(res, 200, { data: { recorded: true } });
});

export const publicArticleCategories: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listPublicArticleCategories() });
});

export const publicArticleTags: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listPublicArticleTags() });
});

export const adminArticles: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, await service.listAdminArticles(adminArticleQuerySchema.parse(req.query)));
});

export const adminArticle: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.getAdminArticle(req.params["id"] as string) });
});

export const articleStats: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.getArticleStats() });
});

export const adminArticleCategories: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listAdminArticleCategories() });
});

export const adminArticleTags: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listAdminArticleTags() });
});

export const createArticle: RequestHandler = asyncHandler(async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw createHttpError(401, "Authentication required");
  sendResponse(res, 201, { data: await service.createArticle(req.body, user) });
});

export const updateArticle: RequestHandler = asyncHandler(async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw createHttpError(401, "Authentication required");
  sendResponse(res, 200, { data: await service.updateArticle(req.params["id"] as string, req.body, user) });
});

export const deleteArticle: RequestHandler = asyncHandler(async (req, res) => {
  await service.deleteArticle(req.params["id"] as string, req.body.expectedVersion);
  sendResponse(res, 200, { data: { deleted: true } });
});
