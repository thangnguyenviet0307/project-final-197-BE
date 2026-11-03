import { z } from "zod";
import { hasReadableContent } from "./information.validation.js";

export const policyKeys = ["warranty", "privacy", "shipping", "returns", "payment", "support"] as const;
export const documentKeys = [...policyKeys, "gioi-thieu", "dieu-khoan-su-dung", "cau-hoi-thuong-gap"] as const;
export const documentParams = z.object({ key: z.enum(documentKeys) }).strict();
export const documentVersion = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
export const documentInput = documentVersion.extend({ content: z.string().trim().max(30000), publish: z.boolean() }).strict()
  .refine(input => !input.publish || hasReadableContent(input.content), { message: "Vui lòng nhập nội dung trước khi công bố.", path: ["content"] });
export type DocumentKey = typeof documentKeys[number];
