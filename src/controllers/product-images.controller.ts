import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import { addProductImage, removeProductImage } from "../services/product-images.service.js";

export const uploadProductImage: RequestHandler = asyncHandler(async (req, res) => {
  const product = await addProductImage(String(req.params["id"]), req.file);
  sendResponse(res, 201, { message: "Product image uploaded", data: product });
});

export const deleteProductImage: RequestHandler = asyncHandler(async (req, res) => {
  const result = await removeProductImage(String(req.params['id']), String(req.params['publicId']));
  sendResponse(res, 200, { message: 'Image removed from gallery', data: result.product, cleanupPending: result.cleanupPending });
});
