import { BrandModel } from '../models/brands.model.js';
import type { IBrand } from '../models/brands.model.js';

export class BrandsService {
  static async getAllBrands() {
    return await BrandModel.find({ isActive: true }).sort({ createdAt: -1 });
  }

  static async getBrandById(id: string) {
    return await BrandModel.findById(id);
  }

  static async createBrand(data: Partial<IBrand>) {
    const newBrand = new BrandModel(data);
    return await newBrand.save();
  }

  static async updateBrand(id: string, data: Partial<IBrand>) {
    return await BrandModel.findByIdAndUpdate(id, data, { new: true });
  }

  static async deleteBrand(id: string) {
    return await BrandModel.findByIdAndDelete(id);
  }
}