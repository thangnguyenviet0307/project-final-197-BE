import mongoose from 'mongoose';
import { BrandModel } from '../models/brands.model.js';
import type { BrandInput } from '../validations/brands.validation.js';

export class BrandService {
  // 1. Lấy danh sách tất cả thương hiệu
  static async getAll() {
    return BrandModel.find().sort({ createdAt: -1 });
  }

  // 2. Lấy thương hiệu theo ID
  static async getById(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    return BrandModel.findById(id);
  }

  // 3. Tạo thương hiệu mới
  static async create(data: BrandInput) {
    return BrandModel.create(data);
  }

  // 4. Cập nhật thương hiệu
  static async update(id: string, data: BrandInput) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    return BrandModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
  }

  // 5. Xóa thương hiệu
  static async delete(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    return BrandModel.findByIdAndDelete(id);
  }
}