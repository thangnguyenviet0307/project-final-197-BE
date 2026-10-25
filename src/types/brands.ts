import type { BaseDocument } from "./common.types.js";

export interface IBrand {
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  isActive?: boolean;
  isDeleted?: boolean;
  deletedAt?: Date | null;
}
export type IBrandDocument = IBrand & BaseDocument;

export interface BrandInput {
  name: string;
  description?: string | undefined;
  logoUrl?: string | undefined;
  isActive?: boolean | undefined;
}
export interface UpdateBrandInput {
  name?: string | undefined;
  description?: string | undefined;
  logoUrl?: string | undefined;
  isActive?: boolean | undefined;
}
