import { z } from "zod";
import { objectId, hasUpdateFields, UPDATE_REQUIRED_MESSAGE } from "./common.validation.js";
import type { HeroSlideInput, UpdateHeroSlideInput } from "../types/hero-slides.type.js";

const heroSlideShape = {
  category: objectId,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000),
  imageUrl: z.url().trim().max(2048).refine(value => /^https?:\/\//i.test(value), "HTTP(S) image URL required").nullable(),
  sortOrder: z.int().min(0).max(10000),
  isActive: z.boolean(),
};
export const createHeroSlideSchema = z.strictObject({
  ...heroSlideShape,
  description: heroSlideShape.description.default(""),
  imageUrl: heroSlideShape.imageUrl.default(null),
  sortOrder: heroSlideShape.sortOrder.default(0),
  isActive: heroSlideShape.isActive.default(true),
}) satisfies z.ZodType<HeroSlideInput>;
export const heroSlideVersionSchema = z.strictObject({ expectedVersion: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
export const updateHeroSlideSchema = z.strictObject(heroSlideShape).partial().extend({
  expectedVersion: heroSlideVersionSchema.shape.expectedVersion,
}).refine(({ expectedVersion, ...fields }) => hasUpdateFields(fields), { error: UPDATE_REQUIRED_MESSAGE }) satisfies z.ZodType<UpdateHeroSlideInput>;
