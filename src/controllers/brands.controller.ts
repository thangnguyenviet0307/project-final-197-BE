import type { Request, Response } from 'express';
import { BrandsService } from '../services/brands.service.js';
import { buildSlugHelper } from '../helpers/buildSlug.helper.js';

export class BrandController {
  // GET /v1/brands
  static async getAll(_req: Request, res: Response) {
    try {
      const brands = await BrandsService.getAllBrands();

      return res.status(200).json({
        success: true,
        data: brands
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // GET /v1/brands/:id
  static async getById(req: Request, res: Response) {
    try {
      const id = req.params['id'] as string;

      const brand = await BrandsService.getBrandById(id);

      if (!brand) {
        return res.status(404).json({
          success: false,
          message: 'Brand không tồn tại'
        });
      }

      return res.status(200).json({
        success: true,
        data: brand
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // POST /v1/brands
  static async create(req: Request, res: Response) {
    try {
      const { name, description, logo } = req.body;

      const slug = buildSlugHelper(name);

      const brand = await BrandsService.createBrand({
        name,
        slug,
        description,
        logo
      });

      return res.status(201).json({
        success: true,
        data: brand
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // PUT /v1/brands/:id
  static async update(req: Request, res: Response) {
    try {
      const id = req.params['id'] as string;

      const { name, description, logo, isActive } = req.body;

      const updateData: any = {
        description,
        logo,
        isActive
      };

      if (name) {
        updateData.name = name;
        updateData.slug = buildSlugHelper(name);
      }

      const updatedBrand = await BrandsService.updateBrand(
        id,
        updateData
      );

      if (!updatedBrand) {
        return res.status(404).json({
          success: false,
          message: 'Brand không tồn tại'
        });
      }

      return res.status(200).json({
        success: true,
        data: updatedBrand
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // DELETE /v1/brands/:id
  static async delete(req: Request, res: Response) {
    try {
      const id = req.params['id'] as string;

      const deletedBrand = await BrandsService.deleteBrand(id);

      if (!deletedBrand) {
        return res.status(404).json({
          success: false,
          message: 'Brand không tồn tại'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Xóa Brand thành công'
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}