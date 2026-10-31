import createHttpError from "http-errors";
import mongoose from "mongoose";
import slugify from "slugify";
import { Article } from "../models/articles.model.js";
import type { AuthUser } from "../types/auth.type.js";
import type { AdminArticleListQuery, ArticleListQuery, ArticleStatus, CreateArticleInput, UpdateArticleInput } from "../types/articles.type.js";
import { buildPagination } from "../utils/pagination.js";

const publicFields = "_id type title slug category excerpt content imageUrl tags authorName publishedAt publishAt isFeatured viewCount seo createdAt updatedAt";

function visibleArticleFilter(now = new Date()): mongoose.QueryFilter<Record<string, unknown>> {
  return {
    $or: [
      { status: "published", $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { status: "scheduled", publishAt: { $lte: now } },
    ],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildListFilter(query: ArticleListQuery | AdminArticleListQuery, publicOnly: boolean): mongoose.QueryFilter<Record<string, unknown>> {
  const conditions: mongoose.QueryFilter<Record<string, unknown>>[] = [];
  if (publicOnly) conditions.push(visibleArticleFilter());
  if (query.type) conditions.push({ type: query.type });
  if (query.category) conditions.push({ category: query.category });
  if (query.tag) conditions.push({ tags: query.tag });
  if (query.isFeatured !== undefined) conditions.push({ isFeatured: query.isFeatured });
  if (!publicOnly && "status" in query && query.status) conditions.push({ status: query.status });
  if (query.search) {
    const search = new RegExp(escapeRegExp(query.search), "i");
    conditions.push({ $or: [
      { title: search },
      { excerpt: search },
      { content: search },
      { category: search },
      { tags: search },
    ] });
  }
  return conditions.length ? { $and: conditions } : {};
}

function sortFor(query: ArticleListQuery | AdminArticleListQuery): Record<string, 1 | -1> {
  if (query.sort === "oldest") return { publishedAt: 1, _id: 1 };
  if (query.sort === "popular") return { viewCount: -1, publishedAt: -1, _id: -1 };
  return { publishedAt: -1, _id: -1 };
}

function toPublicArticle<T extends { publishAt?: Date | null; publishedAt?: Date | null }>(article: T) {
  const { publishAt, publishedAt, ...fields } = article;
  return { ...fields, publishedAt: publishedAt ?? publishAt ?? null };
}

function normalizeSlug(title: string, slug?: string): string {
  const normalized = slug ? slugify(slug, { lower: true, strict: true, trim: true }) : slugify(title, { lower: true, strict: true, trim: true });
  if (!normalized) throw createHttpError(400, "A title or slug must contain letters or numbers.");
  return normalized;
}

async function assertSlugAvailable(slug: string, exceptId?: string): Promise<void> {
  const filter = exceptId ? { slug, _id: { $ne: exceptId } } : { slug };
  if (await Article.exists(filter)) throw createHttpError(409, "Slug này đã được sử dụng.");
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

function isVersionError(error: unknown): boolean {
  return error instanceof mongoose.Error.VersionError;
}

function assertSchedule(status: ArticleStatus, publishAt: Date | null | undefined, requireFutureDate = true): void {
  if (status === "scheduled" && (!publishAt || requireFutureDate && publishAt <= new Date())) {
    throw createHttpError(400, "Bài viết lên lịch cần publishAt ở thời điểm trong tương lai.");
  }
  if (status === "published" && publishAt && publishAt > new Date()) {
    throw createHttpError(400, "Dùng trạng thái scheduled cho thời điểm xuất bản trong tương lai.");
  }
}

function mongoError(error: unknown, fallback: (error: unknown) => never): never {
  if (isDuplicateKeyError(error)) throw createHttpError(409, "Slug này đã được sử dụng.");
  if (isVersionError(error)) throw createHttpError(409, "Bài viết vừa được chỉnh sửa. Tải lại và kiểm tra trước khi lưu.");
  return fallback(error);
}

export async function listPublicArticles(query: ArticleListQuery) {
  const filter = buildListFilter(query, true);
  const [articles, total] = await Promise.all([
    Article.find(filter).select(publicFields).sort(sortFor(query)).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Article.countDocuments(filter),
  ]);
  return { data: articles.map(toPublicArticle), pagination: buildPagination(query.page, query.limit, total) };
}

export async function getPublicArticle(slug: string) {
  const article = await Article.findOne({ ...visibleArticleFilter(), slug }).select(publicFields).lean();
  if (!article) throw createHttpError(404, "Không tìm thấy bài viết.");
  return toPublicArticle(article);
}

export async function recordArticleView(slug: string): Promise<void> {
  const result = await Article.updateOne({ ...visibleArticleFilter(), slug }, { $inc: { viewCount: 1 } });
  if (result.matchedCount === 0) throw createHttpError(404, "Không tìm thấy bài viết.");
}

export async function listPublicArticleCategories(): Promise<string[]> {
  const categories = await Article.distinct("category", visibleArticleFilter());
  return categories.map(String).sort((a, b) => a.localeCompare(b, "vi"));
}

export async function listPublicArticleTags(): Promise<string[]> {
  const tags = await Article.distinct("tags", visibleArticleFilter());
  return tags.map(String).sort((a, b) => a.localeCompare(b, "vi"));
}

export async function listAdminArticles(query: AdminArticleListQuery) {
  const filter = buildListFilter(query, false);
  const [data, total] = await Promise.all([
    Article.find(filter).sort(sortFor(query)).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Article.countDocuments(filter),
  ]);
  return { data, pagination: buildPagination(query.page, query.limit, total) };
}

export async function getAdminArticle(id: string) {
  const article = await Article.findById(id);
  if (!article) throw createHttpError(404, "Không tìm thấy bài viết.");
  return article;
}

export async function getArticleStats() {
  const [rows, total] = await Promise.all([
    Article.aggregate<{ _id: string; count: number; views: number }>([
      { $group: { _id: "$status", count: { $sum: 1 }, views: { $sum: "$viewCount" } } },
    ]),
    Article.countDocuments({}),
  ]);
  const byStatus: Record<ArticleStatus, number> = { draft: 0, scheduled: 0, published: 0, archived: 0 };
  for (const row of rows) {
    if (row._id in byStatus) byStatus[row._id as ArticleStatus] = row.count;
  }
  return { total, byStatus, totalViews: rows.reduce((sum, row) => sum + row.views, 0) };
}

export async function listAdminArticleCategories(): Promise<string[]> {
  const categories = await Article.distinct("category");
  return categories.map(String).sort((a, b) => a.localeCompare(b, "vi"));
}

export async function listAdminArticleTags(): Promise<string[]> {
  const tags = await Article.distinct("tags");
  return tags.map(String).sort((a, b) => a.localeCompare(b, "vi"));
}

export async function createArticle(input: CreateArticleInput, user: AuthUser) {
  const slug = normalizeSlug(input.title, input.slug);
  assertSchedule(input.status, input.publishAt);
  await assertSlugAvailable(slug);
  const article = new Article({
    ...input,
    slug,
    publishAt: input.publishAt ?? null,
    publishedAt: input.status === "published" ? input.publishAt ?? new Date() : input.status === "scheduled" ? input.publishAt : null,
    createdBy: user.id,
    updatedBy: user.id,
  });
  try {
    await article.save();
  } catch (error) {
    return mongoError(error, value => { throw value; });
  }
  return article;
}

export async function updateArticle(id: string, input: UpdateArticleInput, user: AuthUser) {
  const article = await Article.findById(id);
  if (!article) throw createHttpError(404, "Không tìm thấy bài viết.");
  const { expectedVersion, ...fields } = input;
  if ((article.__v ?? 0) !== expectedVersion) throw createHttpError(409, "Bài viết đã thay đổi. Tải lại và kiểm tra trước khi lưu.");

  const status = fields.status ?? article.status as ArticleStatus;
  const publishAt = fields.publishAt === undefined ? article.publishAt : fields.publishAt;
  assertSchedule(status, publishAt, fields.status === "scheduled" || fields.publishAt !== undefined);
  if (fields.slug !== undefined || fields.title !== undefined && article.slug === normalizeSlug(article.title)) {
    const slug = normalizeSlug(fields.title ?? article.title, fields.slug);
    await assertSlugAvailable(slug, id);
    fields.slug = slug;
  }
  const previousStatus = article.status as ArticleStatus;
  article.set(fields);
  if (fields.status === "scheduled") article.publishedAt = publishAt ?? null;
  else if (fields.status === "published" && previousStatus !== "published") article.publishedAt = publishAt ?? new Date();
  article.updatedBy = new mongoose.Types.ObjectId(user.id);
  try {
    await article.save();
  } catch (error) {
    return mongoError(error, value => { throw value; });
  }
  return article;
}

export async function deleteArticle(id: string, expectedVersion: number): Promise<void> {
  const article = await Article.findById(id).select("__v");
  if (!article) throw createHttpError(404, "Không tìm thấy bài viết.");
  if ((article.__v ?? 0) !== expectedVersion) throw createHttpError(409, "Bài viết đã thay đổi. Tải lại trước khi xóa.");
  const result = await Article.deleteOne({ _id: id, __v: expectedVersion });
  if (result.deletedCount === 0) throw createHttpError(409, "Bài viết vừa được chỉnh sửa. Tải lại trước khi xóa.");
}
