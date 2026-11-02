import { z } from "zod";
import { hasUpdateFields, paginationSchema, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { AdminArticleListQuery, ArticleListQuery, CreateArticleInput, UpdateArticleInput } from "../types/articles.type.js";

const slugSchema = z.string().trim().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i).transform(value => value.toLowerCase());
const imageUrlSchema = z.string().trim().max(2048).check(z.url()).refine(value => /^https?:\/\//i.test(value), "HTTP(S) image URL required").nullable();
const articleTypeSchema = z.enum(["news", "blog"]);
const articleStatusSchema = z.enum(["draft", "scheduled", "published", "archived"]);
const seoSchema = z.strictObject({
  title: z.string().trim().max(70).optional(),
  description: z.string().trim().max(160).optional(),
  keywords: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  canonicalUrl: z.string().trim().max(2048).check(z.url()).refine(value => /^https?:\/\//i.test(value), "HTTP(S) URL required").nullable().optional(),
});

const articleFields = {
  type: articleTypeSchema,
  title: z.string().trim().min(3).max(200),
  slug: slugSchema.optional(),
  categoryId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  sortOrder: z.int().min(0).max(10000).optional(),
  category: z.string().trim().min(1).max(80),
  excerpt: z.string().trim().min(1).max(1000),
  content: z.string().trim().min(1).max(100000),
  imageUrl: imageUrlSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  authorName: z.string().trim().min(1).max(120),
  status: articleStatusSchema,
  publishAt: z.iso.datetime({ offset: true }).transform(value => new Date(value)).nullable(),
  isFeatured: z.boolean(),
  seo: seoSchema,
};

const articleFieldsSchema = z.strictObject(articleFields);

export const createArticleSchema = z.strictObject({
  ...articleFields,
  category: articleFields.category.default(""),
  type: articleTypeSchema.default("news"),
  imageUrl: articleFields.imageUrl.default(null),
  tags: articleFields.tags.default([]),
  status: articleStatusSchema.default("draft"),
  publishAt: articleFields.publishAt.default(null),
  isFeatured: articleFields.isFeatured.default(false),
  seo: seoSchema.default({}),
}).superRefine((value, context) => {
  if (!value.categoryId && !value.category) context.addIssue({ code: "custom", path: ["category"], message: "Choose a category" });
  if (value.status === "scheduled" && (!value.publishAt || value.publishAt <= new Date())) {
    context.addIssue({ code: "custom", path: ["publishAt"], message: "Scheduled articles require a future publishAt date" });
  }
  if (value.status === "published" && value.publishAt && value.publishAt > new Date()) {
    context.addIssue({ code: "custom", path: ["status"], message: "Use scheduled status for a future publication date" });
  }
}) satisfies z.ZodType<CreateArticleInput>;

export const updateArticleSchema = articleFieldsSchema.partial().extend({
  expectedVersion: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).refine(value => {
  const { expectedVersion: _expectedVersion, ...fields } = value;
  return hasUpdateFields(fields);
}, { error: UPDATE_REQUIRED_MESSAGE }) satisfies z.ZodType<UpdateArticleInput>;

export const articleIdParamSchema = z.strictObject({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, "ObjectId không hợp lệ") });
export const articleSlugParamSchema = z.strictObject({ slug: slugSchema });
const queryBase = paginationSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  type: articleTypeSchema.optional(),
  category: z.string().trim().min(1).max(80).optional(),
  categoryId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  isFeatured: z.enum(["true", "false"]).transform(value => value === "true").optional(),
  sort: z.enum(["newest", "oldest", "popular", "display"]).default("newest"),
}).strict();
export const publicArticleQuerySchema = queryBase.extend({
  summary: z.enum(["true", "false"]).transform(value => value === "true").optional(),
}) satisfies z.ZodType<ArticleListQuery>;
export const adminArticleQuerySchema = queryBase.extend({
  status: articleStatusSchema.optional(),
}) satisfies z.ZodType<AdminArticleListQuery>;
export const articleVersionSchema = z.strictObject({ expectedVersion: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
