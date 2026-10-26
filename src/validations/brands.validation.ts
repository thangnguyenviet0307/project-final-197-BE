import { hasUpdateFields, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { BrandInput, UpdateBrandInput } from "../types/brands.js";
export type { BrandInput, UpdateBrandInput } from "../types/brands.js";

import { z } from "zod";

// Schema tạo thương hiệu
export const createBrandSchema = z.object({
  logoUrl: z.union([z.string().trim().check(z.url()).regex(/^https?:\/\//i).max(255), z.literal("")]).optional(),
  isActive: z.boolean().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Brand name is required")
    .max(100, "Brand name must not exceed 100 characters"),

  description: z
    .string()
    .trim()
    .optional(),
}) satisfies z.ZodType<BrandInput>;

// Schema cập nhật thương hiệu
export const updateBrandSchema = createBrandSchema
  .partial()
  .refine(
    hasUpdateFields,
    {
      error: UPDATE_REQUIRED_MESSAGE,
    }
  ) satisfies z.ZodType<UpdateBrandInput>;

// TypeScript Types
