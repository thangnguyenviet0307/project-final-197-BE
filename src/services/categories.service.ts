import { Categories } from "../models/categories.model.js";
import type { ICategories } from "../types/categories.js"; 
import { generateSlug } from "../helpers/slug.helpers.js";
import createHttpError from "http-errors";
export class CategoriesService {
  // 1. Create a new category
  public static async createCategory(data: Partial<ICategories>): Promise<ICategories> {
    const slug = generateSlug(data.name!);

    const categoriesName = data.name as string;
    const existingCategories = await Categories.findOne({ 
      $or: [{ name: categoriesName }, { slug }] 
    } as any);

    if (existingCategories) {
      throw createHttpError(409, "Categories with this name or slug already exists");
    }

    const categories = new Categories({
      ...data,
      slug,
    });

    return await categories.save();
  }

  // 2. Get all categories
  public static async getAllCategories(): Promise<ICategories[]> {
    return await Categories.find().populate({ path: "parent", model: Categories, select: "name slug" }).sort({ createdAt: -1 });
  }

  // 3. Get category by ID
  public static async getCategoryById(id: string): Promise<ICategories> {
    const categories = await Categories.findById(id).populate({ path: "parent", model: Categories, select: "name slug" });
    if (!categories) {
      throw createHttpError(404, "Categories not found");
    }
    return categories;
  }

  // 4. Update a category
  public static async updateCategory(id: string, data: Partial<ICategories>): Promise<ICategories> {
    const categories = await Categories.findById(id);
    if (!categories) {
      throw createHttpError(404, "Categories not found");
    }

    if (data.name && data.name !== categories.name) {
      data.slug = generateSlug(data.name);
      
      const categoriesName = data.name as string;
      const categoriesSlug = data.slug as string;

      const existingCategories = await Categories.findOne({ 
        _id: { $ne: id }, 
        $or: [{ name: categoriesName }, { slug: categoriesSlug }] 
      } as any);

      if (existingCategories) {
        throw createHttpError(409, "Categories name or slug already exists");
      }
    }

    Object.assign(categories, data);
    return await categories.save();
  }

  // 5. Delete a category
  public static async deleteCategory(id: string): Promise<void> {
    const categories = await Categories.findById(id);
    if (!categories) {
      throw createHttpError(404, "Categories not found");
    }

    await Categories.updateMany(
      { parent: id }, 
      { $set: { parent: null } } 
    );
    await Categories.findByIdAndDelete(id);
  }
}