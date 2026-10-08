
import type {
  Request,
  Response,
  NextFunction,
} from 'express';

import { BrandService } from '../services/brands.service.js';
import { ApiError } from '../middlewares/error.middleware.js';

import type {
  BrandInput,
  UpdateBrandInput,
} from '../validations/brands.validation.js';

export class BrandController {
  // GET /api/v1/brands
  static async getAll(
    _req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const brands = await BrandService.getAll();

      res.status(200).json({
        success: true,
        message: 'Get brands successfully',
        data: brands,
      });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/v1/brands/:id
  static async getById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = String(req.params['id']);

      const brand = await BrandService.getById(id);

      if (!brand) {
        throw new ApiError(404, 'Brand not found');
      }

      res.status(200).json({
        success: true,
        message: 'Get brand successfully',
        data: brand,
      });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/v1/brands
  static async create(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      // Dữ liệu được Zod Middleware kiểm tra trước
      const data = req.body as BrandInput;

      const brand = await BrandService.create(data);

      res.status(201).json({
        success: true,
        message: 'Brand created successfully',
        data: brand,
      });
    } catch (error) {
      next(error);
    }
  }

  // PUT /api/v1/brands/:id
  static async update(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = String(req.params['id']);

      // Dữ liệu được Zod Middleware kiểm tra trước
      const data = req.body as UpdateBrandInput;

      const brand = await BrandService.update(id, data);

      if (!brand) {
        throw new ApiError(404, 'Brand not found');
      }

      res.status(200).json({
        success: true,
        message: 'Brand updated successfully',
        data: brand,
      });
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/v1/brands/:id
  static async delete(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = String(req.params['id']);

      const brand = await BrandService.delete(id);

      if (!brand) {
        throw new ApiError(404, 'Brand not found');
      }

      res.status(200).json({
        success: true,
        message: 'Brand deleted successfully',
        data: brand,
      });
    } catch (error) {
      next(error);
    }
  }
}
