
import mongoose from 'mongoose';
import createHttpError from 'http-errors';
import Product from '../models/products.model.js';
import { withRelationsTransaction } from '../utils/relations-transaction.js';

import { BrandModel } from '../models/brands.model.js';
import { buildSlug } from '../helpers/buildSlug.helper.js';

import type {
  BrandInput,
  UpdateBrandInput,
} from '../types/brands.js';

export class BrandService {
  static async getPublic() {
    return BrandModel.find({ isActive: true, isDeleted: { $ne: true } })
      .select("_id name slug logoUrl")
      .sort({ name: 1 })
      .lean();
  }

  // 1. Lấy tất cả thương hiệu chưa bị xóa
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
    // Sử dụng hàm buildSlug của nhóm
    const slug = buildSlug(data.name);

    const brandData = {
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
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

    const updateData: UpdateBrandInput & { slug?: string } = { ...data };

    if (data.name !== undefined) {

      // Sử dụng hàm buildSlug của nhóm
      updateData.slug = buildSlug(data.name);
    }

    return withRelationsTransaction(async (session) => BrandModel.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: updateData },
      {
        returnDocument: 'after',
        runValidators: true,
        session,
      }
    ));
  }

  // 5. Xóa mềm thương hiệu
  static async delete(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    return withRelationsTransaction(async (session) => {
      if (await Product.exists({ brand: id }).session(session)) throw createHttpError(409, 'Cannot delete a brand referenced by products');
      return BrandModel.findOneAndUpdate(
        { _id: id, isDeleted: false },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        },
        { returnDocument: 'after', session }
      );
    });
  }
}
