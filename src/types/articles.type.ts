export type ArticleType = "news" | "blog";
export type ArticleStatus = "draft" | "scheduled" | "published" | "archived";

export interface ArticleSeoInput {
  title?: string | undefined;
  description?: string | undefined;
  keywords?: string[] | undefined;
  canonicalUrl?: string | null | undefined;
}

export interface CreateArticleInput {
  type: ArticleType;
  title: string;
  slug?: string | undefined;
  category: string;
  categoryId?: string | undefined;
  sortOrder?: number | undefined;
  excerpt: string;
  content: string;
  imageUrl?: string | null | undefined;
  tags: string[];
  authorName: string;
  status: ArticleStatus;
  publishAt?: Date | null | undefined;
  isFeatured: boolean;
  seo?: ArticleSeoInput | undefined;
}

export type UpdateArticleInput = { [K in keyof CreateArticleInput]?: CreateArticleInput[K] | undefined } & {
  expectedVersion: number;
};

export interface ArticleListQuery {
  summary?: boolean | undefined;
  page: number;
  limit: number;
  search?: string | undefined;
  type?: ArticleType | undefined;
  category?: string | undefined;
  categoryId?: string | undefined;
  tag?: string | undefined;
  status?: ArticleStatus | undefined;
  isFeatured?: boolean | undefined;
  sort?: "newest" | "oldest" | "popular" | "display" | undefined;
}

export interface AdminArticleListQuery extends ArticleListQuery {
  status?: ArticleStatus | undefined;
  sort?: "newest" | "oldest" | "popular" | "display" | undefined;
}
