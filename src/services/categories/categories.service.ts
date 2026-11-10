import { categoryMembership } from '../../utils/products/catalog-reference.js';
import createHttpError from 'http-errors';
import type { ClientSession } from 'mongoose';
import { Categories } from '../../models/categories/categories.model.js';
import Product from '../../models/products/products.model.js';
import type { ICategories } from '../../types/categories/categories.js';
import type {
  CreateCategoriesInput,
  UpdateCategoriesInput,
} from '../../types/categories/categories.js';
import { buildSlug } from '../../helpers/buildSlug.helper.js';
import { withRelationsTransaction } from '../../utils/shared/relations-transaction.js';
import {
  withCatalogImage,
  cleanupCatalogImage,
} from '../products/catalog-image.service.js';

async function validateParent(
  parent: string | null | undefined,
  session: ClientSession,
  id?: string
) {
  const visited = new Set(id ? [id.toLowerCase()] : []);
  let current = parent?.toString().toLowerCase();
  while (current) {
    if (visited.has(current))
      throw createHttpError(409, 'Category hierarchy cannot contain a cycle');
    visited.add(current);
    const ancestor = await Categories.findOne({
      _id: current,
      isDeleted: { $ne: true },
    }).session(session);
    if (!ancestor) throw createHttpError(404, 'Parent category not found');
    current = ancestor.parent?.toString().toLowerCase();
  }
}

export class CategoriesService {
  public static async getPublicCategories() {
    return Categories.find({ isActive: true, isDeleted: { $ne: true } })
      .select('_id name slug icon parent')
      .sort({ name: 1 })
      .lean();
  }

  public static async createCategory(
    data: CreateCategoriesInput,
    file?: Express.Multer.File
  ): Promise<ICategories> {
    return withCatalogImage(file, 'categories', async (image) =>
      withRelationsTransaction(async (session) => {
        await validateParent(data.parent, session);
        const slug = buildSlug(data.name);
        if (
          await Categories.exists({
            $or: [{ name: data.name }, { slug }],
          }).session(session)
        ) {
          throw createHttpError(409, 'Category name or slug already exists');
        }
        return new Categories({
          ...data,
          slug,
          ...(image ? { icon: image.url, imagePublicId: image.publicId } : {}),
        }).save({ session });
      })
    );
  }

  public static async getAllCategories(): Promise<ICategories[]> {
    return Categories.find({ isDeleted: { $ne: true } })
      .populate({ path: 'parent', model: Categories, select: 'name slug' })
      .sort({ createdAt: -1 });
  }

  public static async getCategoryById(id: string): Promise<ICategories> {
    const category = await Categories.findOne({
      _id: id,
      isDeleted: { $ne: true },
    }).populate({ path: 'parent', model: Categories, select: 'name slug' });
    if (!category) throw createHttpError(404, 'Categories not found');
    return category;
  }

  public static async updateCategory(
    id: string,
    data: UpdateCategoriesInput,
    file?: Express.Multer.File
  ): Promise<ICategories> {
    let previous: string | undefined;
    return withCatalogImage(
      file,
      'categories',
      async (image) =>
        withRelationsTransaction(async (session) => {
          const category = await Categories.findOne({
            _id: id,
            isDeleted: { $ne: true },
          }).session(session);
          if (!category) throw createHttpError(404, 'Categories not found');
          await validateParent(data.parent, session, id);
          const slug = data.name ? buildSlug(data.name) : category.slug;
          if (
            data.name &&
            (await Categories.exists({
              _id: { $ne: id },
              $or: [{ name: data.name }, { slug }],
            }).session(session))
          ) {
            throw createHttpError(409, 'Category name or slug already exists');
          }
          previous =
            image || (data.icon !== undefined && data.icon !== category.icon)
              ? category.imagePublicId
              : undefined;
          category.set({
            ...data,
            slug,
            ...(image
              ? { icon: image.url, imagePublicId: image.publicId }
              : previous
                ? { imagePublicId: undefined }
                : {}),
          });
          return category.save({ session });
        }),
      () => previous
    );
  }

  public static async deleteCategory(id: string, childIds: string[] = []) {
    const result = await withRelationsTransaction(async (session) => {
      const category = await Categories.findById(id).session(session);
      if (!category) throw createHttpError(404, 'Categories not found');
      const ids = [
        ...new Set([id, ...childIds].map((value) => value.toLowerCase())),
      ];
      if (await Product.exists(categoryMembership(ids)).session(session)) {
        throw createHttpError(
          409,
          'Cannot delete a category referenced by products'
        );
      }
      const selected = childIds.length
        ? await Categories.find({ _id: { $in: childIds }, parent: id }).session(
            session
          )
        : [];
      if (selected.length !== childIds.length)
        throw createHttpError(
          409,
          'Selected child categories changed; reload before deleting'
        );
      const promoted = await Categories.updateMany(
        { parent: { $in: ids }, _id: { $nin: ids } },
        { $set: { parent: null } },
        { session }
      );
      const deleted = await Categories.deleteMany(
        { _id: { $in: ids } },
        { session }
      );
      if (deleted.deletedCount !== ids.length)
        throw createHttpError(
          409,
          'Categories changed; reload before deleting'
        );
      return {
        deletedIds: ids,
        promotedCount: promoted.modifiedCount,
        imageIds: [category, ...selected].map((item) => item.imagePublicId),
      };
    });
    await Promise.all(
      result.imageIds.map((image) => cleanupCatalogImage(image))
    );
    return {
      deletedIds: result.deletedIds,
      promotedCount: result.promotedCount,
    };
  }
}
