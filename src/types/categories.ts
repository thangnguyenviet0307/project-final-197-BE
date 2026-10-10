import type { Types } from "mongoose";
import type { BaseDocument } from "./common.types.js";

export interface ICategories {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  icon?: string;
  parent?: Types.ObjectId;
  isActive?: boolean;
  isDeleted?: boolean;
  deletedAt?: Date | null;
}
export type ICategoriesDocument = ICategories & BaseDocument;
