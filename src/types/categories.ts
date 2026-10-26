import type { Types } from "mongoose";
import type { BaseDocument } from "./common.types.js";

export interface ICategories {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  icon?: string;
  parent?: Types.ObjectId | null;
  isActive?: boolean;
  isDeleted?: boolean;
  deletedAt?: Date | null;
}
export type ICategoriesDocument = ICategories & BaseDocument;

// API parent IDs are strings; the stored model uses Types.ObjectId.
export interface CreateCategoriesInput {
  icon?: string | undefined;
  name: string;
  description?: string | undefined;
  icon?: string | undefined;
  parent?: string | null | undefined;
  isActive?: boolean | undefined;
}
export interface UpdateCategoriesInput {
  icon?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  icon?: string | undefined;
  parent?: string | null | undefined;
  isActive?: boolean | undefined;
}
