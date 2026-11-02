import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import * as service from "../services/post-categories.service.js";
export const list: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listPostCategories() });
});
export const publicList: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listPostCategories(true) });
});
export const create: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 201, { data: await service.createPostCategory(req.body) });
});
export const update: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await service.updatePostCategory(
      req.params["id"] as string,
      req.body,
    ),
  });
});
export const remove: RequestHandler = asyncHandler(async (req, res) => {
  await service.deletePostCategory(
    req.params["id"] as string,
    req.body.expectedVersion,
  );
  sendResponse(res, 200, { data: { deleted: true } });
});
