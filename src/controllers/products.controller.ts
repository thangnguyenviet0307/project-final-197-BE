import { updateInventory } from "../services/products.service.js";
import { assertFound } from "../utils/assert-found.js";
import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import type { Request, Response } from "express";
import productService from "../services/products.service.js";

const getAllProducts: RequestHandler = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const filters = req.query as unknown as import("../types/products.type.js").GetProductsQuery;
  const result = await productService.getAllProducts(filters);

  return sendResponse(res, 200, {
    success: true,
    message: "Lấy danh sách sản phẩm thành công",
    ...result,
  });
});

const getStatistics: RequestHandler = asyncHandler(async (_req, res) => {
  return sendResponse(res, 200, { data: await productService.getStatistics() });
});

const getProductBySku: RequestHandler = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const sku = req.params["sku"] as string;

  const product = await productService.getProductBySku(sku);

  assertFound(product, "Không tìm thấy sản phẩm theo SKU");

  return sendResponse(res, 200, {
    success: true,
    message: "Tìm sản phẩm theo SKU thành công",
    data: product,
  });
});

const getVariantByProductAndVariantId: RequestHandler = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const productId = req.params["productId"] as string;
  const variantId = req.params["variantId"] as string;

  const result = await productService.getVariantByProductAndVariantId(
    productId,
    variantId,
  );

  assertFound(result, "Không tìm thấy biến thể sản phẩm");

  return sendResponse(res, 200, {
    success: true,
    message: "Lấy biến thể sản phẩm thành công",
    data: result,
  });
});

const getProductById: RequestHandler = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const id = req.params["id"] as string;

  const product = await productService.getProductById(id);

  assertFound(product, "Không tìm thấy sản phẩm");

  return sendResponse(res, 200, {
    success: true,
    message: "Lấy sản phẩm thành công",
    data: product,
  });
});

const createProduct: RequestHandler = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const product = await productService.createProduct(req.body);

  return sendResponse(res, 201, {
    success: true,
    message: "Tạo sản phẩm thành công",
    data: product,
  });
});

const updateProduct: RequestHandler = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const id = req.params["id"] as string;

  const product = await productService.updateProduct(id, req.body);

  assertFound(product, "Không tìm thấy sản phẩm để cập nhật");

  return sendResponse(res, 200, {
    success: true,
    message: "Cập nhật sản phẩm thành công",
    data: product,
  });
});

const deleteProduct: RequestHandler = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  const id = req.params["id"] as string;

  const product = await productService.deleteProduct(id);

  assertFound(product, "Không tìm thấy sản phẩm để xoá");

  return sendResponse(res, 200, {
    success: true,
    message: "Xoá sản phẩm thành công",
    data: product,
  });
});

const productsController: Record<
  "updateInventory" | "getStatistics" | "getAllProducts" | "getProductBySku" | "getVariantByProductAndVariantId" |
  "getProductById" | "createProduct" | "updateProduct" | "deleteProduct", RequestHandler
> = {
  updateInventory: asyncHandler(async (req, res) => {
    const product = await updateInventory(req.params['id'] as string, req.body);
    sendResponse(res, 200, { success: true, data: product });
  }),
  getStatistics,
  getAllProducts,
  getProductBySku,
  getVariantByProductAndVariantId,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
export default productsController;
