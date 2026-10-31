import { z } from "zod";
import { objectId } from "./common.validation.js";

export const productNewsSchema = z.strictObject({
  articleIds: z.array(objectId.transform(value => value.toLowerCase())).max(5).refine(ids => new Set(ids).size === ids.length, "Duplicate news articles"),
  expectedVersion: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
