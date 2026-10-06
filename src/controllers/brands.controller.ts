import type { NextFunction, Request, Response } from "express";
import brandService from "../services/brands.service.js";

const getAllBrands = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const brands = await brandService.getAllBrands();

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Lấy danh sách thương hiệu thành công",
      data: brands,
    });
  } catch (error) {
    next(error);
  }
};

const getBrandById = async (
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
        message: "ID thương hiệu không hợp lệ",
        data: null,
      });
    }

    const brand = await brandService.getBrandById(id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Không tìm thấy thương hiệu",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Lấy thương hiệu thành công",
      data: brand,
    });
  } catch (error) {
    return next(error);
  }
};

const createBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brand = await brandService.createBrand(req.body);

    res.status(201).json({
      success: true,
      statusCode: 201,
      message: "Tạo thương hiệu thành công",
      data: brand,
    });
  } catch (error) {
    next(error);
  }
};

const updateBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"];

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "ID thương hiệu không hợp lệ",
        data: null,
      });
    }

    const brand = await brandService.updateBrand(id, req.body);

    if (!brand) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Không tìm thấy thương hiệu để cập nhật",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Cập nhật thương hiệu thành công",
      data: brand,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"];

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "ID thương hiệu không hợp lệ",
        data: null,
      });
    }

    const brand = await brandService.deleteBrand(id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Không tìm thấy thương hiệu để xoá",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Xoá thương hiệu thành công",
      data: brand,
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
};
