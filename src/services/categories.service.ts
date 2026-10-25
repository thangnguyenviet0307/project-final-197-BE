import createHttpError from "http-errors";
import type { ClientSession } from "mongoose";
import { Categories } from "../models/categories.model.js";
import Product from "../models/products.model.js";
import type { ICategories } from "../types/categories.js";
import type { CreateCategoriesInput, UpdateCategoriesInput } from "../types/categories.js";
import { buildSlug } from "../helpers/buildSlug.helper.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";

async function validateParent(parent: string | null | undefined, session: ClientSession, id?: string) {
  const visited = new Set(id ? [id.toLowerCase()] : []);
  let current = parent?.toString().toLowerCase();
  while (current) {
    if (visited.has(current)) throw createHttpError(409, "Category hierarchy cannot contain a cycle");
    visited.add(current);
    const ancestor = await Categories.findOne({ _id: current, isDeleted: { $ne: true } }).session(session);
    if (!ancestor) throw createHttpError(404, "Parent category not found");
    current = ancestor.parent?.toString().toLowerCase();
  }
}

export class CategoriesService {
  public static async createCategory(data: CreateCategoriesInput): Promise<ICategories> {
    return withRelationsTransaction(async (session) => {
      await validateParent(data.parent, session);
      const slug = buildSlug(data.name);
      if (await Categories.exists({ $or: [{ name: data.name }, { slug }] }).session(session)) {
        throw createHttpError(409, "Category name or slug already exists");
      }
      return new Categories({ ...data, slug }).save({ session });
    });
  }

  public static async getAllCategories(): Promise<ICategories[]> {
    return Categories.find({ isDeleted: { $ne: true } })
      .populate({ path: "parent", model: Categories, select: "name slug" }).sort({ createdAt: -1 });
  }

  public static async getCategoryById(id: string): Promise<ICategories> {
    const category = await Categories.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate({ path: "parent", model: Categories, select: "name slug" });
    if (!category) throw createHttpError(404, "Categories not found");
    return category;
  }

  public static async updateCategory(id: string, data: UpdateCategoriesInput): Promise<ICategories> {
    return withRelationsTransaction(async (session) => {
      const category = await Categories.findOne({ _id: id, isDeleted: { $ne: true } }).session(session);
      if (!category) throw createHttpError(404, "Categories not found");
      await validateParent(data.parent, session, id);
      const slug = data.name ? buildSlug(data.name) : category.slug;
      if (data.name && await Categories.exists({ _id: { $ne: id }, $or: [{ name: data.name }, { slug }] }).session(session)) {
        throw createHttpError(409, "Category name or slug already exists");
      }
      category.set({ ...data, slug });
      return category.save({ session });
    });
  }

  public static async deleteCategory(id: string): Promise<void> {
    return withRelationsTransaction(async (session) => {
      const category = await Categories.findById(id).session(session);
      if (!category) throw createHttpError(404, "Categories not found");
      if (await Product.exists({ category: id }).session(session)) {
        throw createHttpError(409, "Cannot delete a category referenced by products");
      }
      await Categories.updateMany({ parent: id }, { $set: { parent: null } }, { session });
      await Categories.findByIdAndDelete(id, { session });
    });
  }
}
