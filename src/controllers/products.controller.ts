import type { NextFunction, Request, Response } from "express";
import productService from "../services/products.service.js";

const getAllProducts = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const items = await productService.getAllProducts();

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Lấy danh sách sản phẩm thành công",
      data: items,
    });
  } catch (error) {
    return next(error);
  }
};

const getProductById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params["id"];

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "ID sản phẩm không hợp lệ",
        data: null,
      });
    }

    const product = await productService.getProductById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Không tìm thấy sản phẩm",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Lấy sản phẩm thành công",
      data: product,
    });
  } catch (error) {
    return next(error);
  }
};

const createProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const product = await productService.createProduct(req.body);

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: "Tạo sản phẩm thành công",
      data: product,
    });
  } catch (error) {
    return next(error);
  }
};

const updateProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params["id"];

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "ID sản phẩm không hợp lệ",
        data: null,
      });
    }

    const product = await productService.updateProduct(id, req.body);

    if (!product) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Không tìm thấy sản phẩm để cập nhật",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Cập nhật sản phẩm thành công",
      data: product,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params["id"];

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "ID sản phẩm không hợp lệ",
        data: null,
      });
    }

    const product = await productService.deleteProduct(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Không tìm thấy sản phẩm để xoá",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Xoá sản phẩm thành công",
      data: product,
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
