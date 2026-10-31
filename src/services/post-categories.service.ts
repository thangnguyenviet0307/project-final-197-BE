import createHttpError from "http-errors";
import type { z } from "zod";
import { PostCategory } from "../models/post-categories.model.js";
import { Article } from "../models/articles.model.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import type { createPostCategorySchema, updatePostCategorySchema } from "../validations/post-categories.validation.js";
export async function listPostCategories(publicOnly = false) {
  const query = PostCategory.find(publicOnly ? { isActive: true } : {});
  if (publicOnly) query.select("_id name slug description");
  return query.sort({ name: 1, _id: 1 }).lean();
}
export async function createPostCategory(input: z.infer<typeof createPostCategorySchema>) {
  return PostCategory.create(input);
}
export async function updatePostCategory(id: string, input: z.infer<typeof updatePostCategorySchema>) {
  return withRelationsTransaction(async session => {
    const category = await PostCategory.findById(id).session(session);
    if (!category) throw createHttpError(404, "Post category not found");
    const { expectedVersion, ...fields } = input;
    if (category.__v !== expectedVersion) throw createHttpError(409, "Category changed; reload before saving", { businessCode: "VERSION_CONFLICT" });
    const renamed = fields.name !== undefined && fields.name !== category.name;
    category.set(fields);
    await category.save({ session });
    if (renamed) await Article.updateMany({ categoryId: id }, { $set: { category: fields.name }, $inc: { __v: 1 } }, { session });
    return category;
  });
}
export async function deletePostCategory(id: string, expectedVersion: number) {
  return withRelationsTransaction(async session => {
    if (await Article.exists({ categoryId: id }).session(session)) throw createHttpError(409, "Move posts to another category before deleting");
    const category = await PostCategory.findById(id).session(session);
    if (!category) throw createHttpError(404, "Post category not found");
    const result = await PostCategory.deleteOne({ _id: id, __v: expectedVersion }, { session });
    if (!result.deletedCount) throw createHttpError(409, "Category changed; reload before deleting", { businessCode: "VERSION_CONFLICT" });
  });
}
