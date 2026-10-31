import type { ClientSession } from "mongoose";
import { PostCategory } from "../models/post-categories.model.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import createHttpError from "http-errors";
import mongoose from "mongoose";
import slugify from "slugify";
import { Article } from "../models/articles.model.js";
import type { AuthUser } from "../types/auth.type.js";
import type { AdminArticleListQuery, ArticleListQuery, ArticleStatus, CreateArticleInput, UpdateArticleInput } from "../types/articles.type.js";
import { buildPagination } from "../utils/pagination.js";

const publicFields = "_id type title slug category excerpt content imageUrl tags authorName publishedAt publishAt isFeatured viewCount seo categoryId sortOrder createdAt updatedAt";
const publicSummaryFields = publicFields.split(" ").filter(field => field !== "content").join(" ");

async function visibleArticleFilter(now = new Date()): Promise<mongoose.QueryFilter<Record<string, unknown>>> {
  const active = await PostCategory.find({ isActive: true }).select("_id").lean();
  return {
    $and: [{ $or: [{ categoryId: null }, { categoryId: { $in: active.map(item => item._id) } }] }],
    $or: [
      { status: "published", $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { status: "scheduled", publishAt: { $type: "date", $lte: now } },
    ],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildListFilter(query: ArticleListQuery | AdminArticleListQuery, publicOnly: boolean): Promise<mongoose.QueryFilter<Record<string, unknown>>> {
  const conditions: mongoose.QueryFilter<Record<string, unknown>>[] = [];
  if (publicOnly) conditions.push(await visibleArticleFilter());
  if (query.type) conditions.push({ type: query.type });
  if (query.categoryId) conditions.push({ categoryId: new mongoose.Types.ObjectId(query.categoryId) });
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
  if (query.sort === "display") return { sortOrder: 1, publishedAt: -1, _id: -1 };
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
  if (isVersionError(error)) throw createHttpError(409, "Bài viết vừa được chỉnh sửa. Tải lại và kiểm tra trước khi lưu.", { businessCode: "VERSION_CONFLICT" });
  return fallback(error);
}

export async function listPublicArticles(query: ArticleListQuery) {
  const filter = await buildListFilter(query, true);
  const [articles, total] = await Promise.all([
    Article.find(filter).select(query.summary ? publicSummaryFields : publicFields).sort(sortFor(query)).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Article.countDocuments(filter),
  ]);
  return { data: articles.map(toPublicArticle), pagination: buildPagination(query.page, query.limit, total) };
}

export async function getPublicArticle(slug: string) {
  const article = await Article.findOne({ ...await visibleArticleFilter(), slug }).select(publicFields).lean();
  if (!article) throw createHttpError(404, "Không tìm thấy bài viết.");
  return toPublicArticle(article);
}

export async function recordArticleView(slug: string): Promise<void> {
  const result = await Article.updateOne({ ...await visibleArticleFilter(), slug }, { $inc: { viewCount: 1 } });
  if (result.matchedCount === 0) throw createHttpError(404, "Không tìm thấy bài viết.");
}

export async function listPublicArticleCategories(): Promise<string[]> {
  const categories = await Article.distinct("category", await visibleArticleFilter());
  return categories.map(String).sort((a, b) => a.localeCompare(b, "vi"));
}

export async function listPublicArticleTags(): Promise<string[]> {
  const tags = await Article.distinct("tags", await visibleArticleFilter());
  return tags.map(String).sort((a, b) => a.localeCompare(b, "vi"));
}

export async function listAdminArticles(query: AdminArticleListQuery) {
  const filter = await buildListFilter(query, false);
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
  return withRelationsTransaction(session => createArticleInSession(input, user, session));
}
async function createArticleInSession(input: CreateArticleInput, user: AuthUser, session: ClientSession) {
  const category = await PostCategory.findOne({ ...(input.categoryId ? { _id: input.categoryId } : { name: input.category }), isActive: true }).session(session);
  if (!category) throw createHttpError(400, "Choose an active post category");
  input = { ...input, categoryId: category._id.toString(), category: category.name };
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
    await article.save({ session });
  } catch (error) {
    return mongoError(error, value => { throw value; });
  }
  return article;
}

export async function updateArticle(id: string, input: UpdateArticleInput, user: AuthUser) {
  return withRelationsTransaction(session => updateArticleInSession(id, input, user, session));
}
async function updateArticleInSession(id: string, input: UpdateArticleInput, user: AuthUser, session: ClientSession) {
  const article = await Article.findById(id).session(session);
  if (!article) throw createHttpError(404, "Không tìm thấy bài viết.");
  const { expectedVersion, ...fields } = input;
  if ((article.__v ?? 0) !== expectedVersion) throw createHttpError(409, "Bài viết đã thay đổi. Tải lại và kiểm tra trước khi lưu.", { businessCode: "VERSION_CONFLICT" });

  const status = fields.status ?? article.status as ArticleStatus;
  const publishAt = fields.publishAt === undefined ? article.publishAt : fields.publishAt;
  assertSchedule(status, publishAt, fields.status === "scheduled" || fields.publishAt !== undefined);
  if (fields.category !== undefined && !fields.categoryId && (!article.categoryId || fields.category !== article.category)) {
    const selectedCategory = await PostCategory.findOne({ name: fields.category, isActive: true }).session(session);
    if (!selectedCategory) throw createHttpError(400, "Choose an active post category");
    fields.categoryId = selectedCategory._id.toString();
  }
  const categoryId = fields.categoryId ?? article.categoryId?.toString();
  if (categoryId) {
    const category = await PostCategory.findById(categoryId).session(session);
    if (!category || (!category.isActive && (fields.categoryId !== undefined || fields.status === "published" || fields.status === "scheduled"))) throw createHttpError(400, "Choose an active post category");
    fields.category = category.name;
  }
  if (fields.slug !== undefined) {
    const slug = normalizeSlug(fields.title ?? article.title, fields.slug);
    await assertSlugAvailable(slug, id);
    fields.slug = slug;
  }
  const previousStatus = article.status as ArticleStatus;
  if (fields.seo) fields.seo = { title: article.seo?.title ?? "", description: article.seo?.description ?? "", keywords: article.seo?.keywords ?? [], canonicalUrl: article.seo?.canonicalUrl ?? null, ...fields.seo };
  article.set(fields);
  if (status === "scheduled" && (fields.status !== undefined || fields.publishAt !== undefined)) article.publishedAt = publishAt ?? null;
  else if (status === "published" && (previousStatus !== "published" || fields.publishAt !== undefined)) article.publishedAt = publishAt ?? new Date();
  article.updatedBy = new mongoose.Types.ObjectId(user.id);
  try {
    await article.save({ session });
  } catch (error) {
    return mongoError(error, value => { throw value; });
  }
  return article;
}

export async function deleteArticle(id: string, expectedVersion: number): Promise<void> {
  return withRelationsTransaction(session => deleteArticleInSession(id, expectedVersion, session));
}
async function deleteArticleInSession(id: string, expectedVersion: number, session: ClientSession): Promise<void> {
  const article = await Article.findById(id).select("__v").session(session);
  if (!article) throw createHttpError(404, "Không tìm thấy bài viết.");
  if ((article.__v ?? 0) !== expectedVersion) throw createHttpError(409, "Bài viết đã thay đổi. Tải lại trước khi xóa.", { businessCode: "VERSION_CONFLICT" });
  const result = await Article.deleteOne({ _id: id, __v: expectedVersion }, { session });
  if (result.deletedCount === 0) throw createHttpError(409, "Bài viết vừa được chỉnh sửa. Tải lại trước khi xóa.", { businessCode: "VERSION_CONFLICT" });
}
