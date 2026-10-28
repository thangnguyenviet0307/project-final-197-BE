import { assertFound } from "../utils/assert-found.js";
import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import type {
  Request,
  Response,
} from 'express';

import { BrandService } from '../services/brands.service.js';


import type {
  BrandInput,
  UpdateBrandInput,
} from '../types/brands.js';

export class BrandController {
  static getPublic: RequestHandler = asyncHandler(async (_req, res) => {
    const brands = await BrandService.getPublic();
    sendResponse(res, 200, { success: true, data: brands });
  });
  // GET /api/v1/brands
  static getAll: RequestHandler = asyncHandler(async (
    _req: Request,
    res: Response,
  ) => {
    const brands = await BrandService.getAll();

    sendResponse(res, 200, {
      success: true,
      message: 'Get brands successfully',
      data: brands,
    });
  });

  // GET /api/v1/brands/:id
  static getById: RequestHandler = asyncHandler(async (
    req: Request,
    res: Response,
  ) => {
    const id = String(req.params['id']);
    const brand = await BrandService.getById(id);

    assertFound(brand, 'Brand not found');

    sendResponse(res, 200, {
      success: true,
      message: 'Get brand successfully',
      data: brand,
    });
  });

  // POST /api/v1/brands
  static create: RequestHandler = asyncHandler(async (
    req: Request,
    res: Response,
  ) => {
    const data = req.body as BrandInput;
    const brand = await BrandService.create(data);

    sendResponse(res, 201, {
      success: true,
      message: 'Brand created successfully',
      data: brand,
    });
  });

  // PUT /api/v1/brands/:id
  static update: RequestHandler = asyncHandler(async (
    req: Request,
    res: Response,
  ) => {
    const id = String(req.params['id']);
    const data = req.body as UpdateBrandInput;

    const brand = await BrandService.update(id, data);

    assertFound(brand, 'Brand not found');

    sendResponse(res, 200, {
      success: true,
      message: 'Brand updated successfully',
      data: brand,
    });
  });

  // DELETE /api/v1/brands/:id
  static delete: RequestHandler = asyncHandler(async (
    req: Request,
    res: Response,
  ) => {
    const id = String(req.params['id']);
    const brand = await BrandService.delete(id);

    assertFound(brand, 'Brand not found');

    sendResponse(res, 200, {
      success: true,
      message: 'Brand deleted successfully',
      data: brand,
    });
  });
}
