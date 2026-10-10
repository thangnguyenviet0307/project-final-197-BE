
import mongoose from 'mongoose';
import { BrandModel } from '../models/brands.model.js';
import { buildSlug } from '../helpers/buildSlug.helper.js';

import type {
  BrandInput,
  UpdateBrandInput,
} from '../validations/brands.validation.js';

export class BrandService {
  // 1. Lấy danh sách thương hiệu chưa bị xóa
  static async getAll() {
    return BrandModel.find({
      isDeleted: false,
    }).sort({ createdAt: -1 });
  }

  // 2. Lấy thương hiệu theo ID
  static async getById(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    return BrandModel.findOne({
      _id: id,
      isDeleted: false,
    });
  }

  // 3. Tạo thương hiệu mới
  static async create(data: BrandInput) {
    const slug = buildSlug(data.name);

    const brandData = {
      name: data.name,
      slug,
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
    };

    return BrandModel.create(brandData);
  }

  // 4. Cập nhật thương hiệu
  static async update(
    id: string,
    data: UpdateBrandInput
  ) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    const updateData: {
      name?: string;
      slug?: string;
      description?: string;
    } = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
      updateData.slug = buildSlug(data.name);
    }

    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    return BrandModel.findOneAndUpdate(
      {
        _id: id,
        isDeleted: false,
      },
      {
        $set: updateData,
      },
      {
        new: true,
        runValidators: true,
      }
    );
  }

  // 5. Xóa mềm thương hiệu
  static async delete(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    return BrandModel.findOneAndUpdate(
      {
        _id: id,
        isDeleted: false,
      },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      },
      {
        new: true,
      }
    );
  }
}
