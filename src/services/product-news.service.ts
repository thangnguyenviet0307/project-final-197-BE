import createHttpError from "http-errors";
import Product from "../models/products.model.js";
import { Article } from "../models/articles.model.js";
import { visibleArticleFilter } from "./articles.service.js";
import { visibleCatalogFilter } from "./store-products.service.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";

const fields = "_id title slug excerpt imageUrl publishedAt publishAt";
function ordered<T extends { _id: unknown }>(ids: readonly unknown[], articles: T[]) {
  const byId = new Map(articles.map(article => [String(article._id), article]));
  return ids.flatMap(id => { const article = byId.get(String(id)); return article ? [article] : []; });
}

export async function getProductNews(id: string) {
  const product = await Product.findById(id).select("relatedNewsIds __v").lean();
  if (!product) throw createHttpError(404, "Product not found");
  const ids = product.relatedNewsIds ?? [];
  const articles = await Article.find({ _id: { $in: ids }, type: "news" }).select(`${fields} status`).lean();
  return { articleIds: ids.map(String), expectedVersion: product.__v ?? 0, articles: ordered(ids, articles) };
}

export async function updateProductNews(id: string, input: { articleIds: string[]; expectedVersion: number }) {
  return withRelationsTransaction(async session => {
    const product = await Product.findById(id).session(session);
    if (!product) throw createHttpError(404, "Product not found");
    if ((product.__v ?? 0) !== input.expectedVersion) throw createHttpError(409, "Product changed; reload before saving news", { businessCode: "VERSION_CONFLICT" });
    const articles = await Article.find({ _id: { $in: input.articleIds }, type: "news" }).select("_id").session(session);
    if (articles.length !== input.articleIds.length) throw createHttpError(400, "Choose existing news articles only");
    product.set("relatedNewsIds", input.articleIds);
    // Even identical selections must participate in product optimistic concurrency.
    product.markModified("relatedNewsIds");
    await product.save({ session });
    return { articleIds: product.relatedNewsIds.map(String), expectedVersion: product.__v ?? 0 };
  });
}

export async function publicProductNews(slug: string) {
  const product = await Product.findOne({ slug, is_active: true, ...await visibleCatalogFilter() }).select("relatedNewsIds").lean();
  if (!product) throw createHttpError(404, "Public product not found");
  const ids = product.relatedNewsIds ?? [];
  if (!ids.length) return [];
  const articles = await Article.find({ ...await visibleArticleFilter(), _id: { $in: ids }, type: "news" }).select(fields).lean();
  return ordered(ids, articles).map(({ publishAt, publishedAt, ...article }) => ({ ...article, publishedAt: publishedAt ?? publishAt ?? null }));
}
