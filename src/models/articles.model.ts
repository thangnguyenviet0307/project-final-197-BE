import { model, Schema } from "mongoose";
import type { ArticleStatus, ArticleType } from "../types/articles.type.js";

const seoSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 70, default: "" },
    description: { type: String, trim: true, maxlength: 160, default: "" },
    keywords: { type: [String], default: [] },
    canonicalUrl: { type: String, maxlength: 2048, default: null },
  },
  { _id: false },
);

const articleSchema = new Schema(
  {
    type: { type: String, enum: ["news", "blog"] satisfies ArticleType[], required: true, default: "news" },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 255 },
    categoryId: { type: Schema.Types.ObjectId, ref: "PostCategory", default: null },
    sortOrder: { type: Number, min: 0, max: 10000, default: 0 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    excerpt: { type: String, required: true, trim: true, maxlength: 1000 },
    content: { type: String, required: true, maxlength: 100000 },
    imageUrl: { type: String, maxlength: 2048, default: null },
    tags: { type: [String], default: [] },
    authorName: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: ["draft", "scheduled", "published", "archived"] satisfies ArticleStatus[], required: true, default: "draft" },
    publishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    isFeatured: { type: Boolean, default: false },
    viewCount: { type: Number, min: 0, default: 0 },
    seo: { type: seoSchema, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, select: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, select: false },
  },
  { collection: "posts", timestamps: true, optimisticConcurrency: true },
);

articleSchema.index({ slug: 1 }, { unique: true });
articleSchema.index({ status: 1, publishAt: 1, publishedAt: -1 });
articleSchema.index({ type: 1, status: 1, category: 1, publishedAt: -1 });
articleSchema.index({ isFeatured: 1, status: 1, publishedAt: -1 });
articleSchema.index({ type: 1, isFeatured: 1, sortOrder: 1, publishedAt: -1 });
articleSchema.index({ categoryId: 1, status: 1 });
articleSchema.index({ tags: 1, status: 1, publishedAt: -1 });

export const Article = model("Article", articleSchema);
