import mongoose from 'mongoose';
import createHttpError from 'http-errors';
import Product from '../../models/products/products.model.js';
import {
  withCatalogImage,
  cleanupCatalogImage,
} from '../products/catalog-image.service.js';
import { withRelationsTransaction } from '../../utils/shared/relations-transaction.js';

import { BrandModel } from '../../models/brands/brands.model.js';
import { buildSlug } from '../../helpers/buildSlug.helper.js';

import type {
  BrandInput,
  UpdateBrandInput,
} from '../../types/brands/brands.js';

export class BrandService {
  static async getPublic() {
    return BrandModel.find({ isActive: true, isDeleted: { $ne: true } })
      .select('_id name slug logoUrl')
      .sort({ name: 1, _id: 1 })
      .lean();
  }
  // 1. Lấy tất cả thương hiệu chưa bị xóa
  static async getAll() {
    return BrandModel.find({
      isDeleted: { $ne: true },
    }).sort({ createdAt: -1 });
  }

  // 2. Lấy thương hiệu theo ID
  static async getById(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    return BrandModel.findOne({
      _id: id,
      isDeleted: { $ne: true },
    });
  }

  // 3. Tạo thương hiệu mới
  static async create(data: BrandInput, file?: Express.Multer.File) {
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

    return withCatalogImage(file, 'brands', async (image) =>
      BrandModel.create({
        ...brandData,
        ...(image ? { logoUrl: image.url, imagePublicId: image.publicId } : {}),
      })
    );
  }

  // 4. Cập nhật thương hiệu
  static async update(
    id: string,
    data: UpdateBrandInput,
    file?: Express.Multer.File
  ) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    const updateData: UpdateBrandInput & { slug?: string } = { ...data };

    if (data.name !== undefined) {
      // Sử dụng hàm buildSlug của nhóm
      updateData.slug = buildSlug(data.name);
    }

    let previous: string | undefined;
    return withCatalogImage(
      file,
      'brands',
      async (image) =>
        withRelationsTransaction(async (session) => {
          const imageChanged = image || data.logoUrl !== undefined;
          if (imageChanged) {
            const existing = await BrandModel.findOne({
              _id: id,
              isDeleted: { $ne: true },
            }).session(session);
            if (!existing) throw createHttpError(404, 'Brand not found');
            previous =
              image || data.logoUrl !== existing.logoUrl
                ? existing.imagePublicId
                : undefined;
          }
          return BrandModel.findOneAndUpdate(
            { _id: id, isDeleted: { $ne: true } },
            {
              $set: {
                ...updateData,
                ...(image
                  ? { logoUrl: image.url, imagePublicId: image.publicId }
                  : {}),
              },
              ...(!image && previous ? { $unset: { imagePublicId: 1 } } : {}),
            },
            {
              returnDocument: 'after',
              runValidators: true,
              session,
            }
          );
        }),
      () => previous
    );
  }

  // 5. Permanently delete an unreferenced brand
  static async delete(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    const deleted = await withRelationsTransaction(async (session) => {
      if (await Product.exists({ brand: id }).session(session))
        throw createHttpError(
          409,
          'Cannot delete a brand referenced by products'
        );
      return BrandModel.findByIdAndDelete(id, { session });
    });
    await cleanupCatalogImage(deleted?.imagePublicId);
    return deleted;
  }
}
