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
