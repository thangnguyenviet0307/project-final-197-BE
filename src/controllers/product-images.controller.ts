import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import { addProductImage } from "../services/product-images.service.js";

export const uploadProductImage = asyncHandler(async (req, res) => {
  const product = await addProductImage(String(req.params["id"]), req.file);
  sendResponse(res, 201, { message: "Product image uploaded", data: product });
});
