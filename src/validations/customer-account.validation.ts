import { z } from "zod";
import { updateProfileSchema } from "./profile.validation.js";

export const birthDateSchema = z.string().refine(value => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getTime() <= Date.now();
}, "NgÃ y sinh khÃ´ng há»£p lá»‡ hoáº·c náº±m trong tÆ°Æ¡ng lai.");
export const customerProfileSchema = updateProfileSchema.extend({
  // Fields removed from the customer UI stay untouched when omitted.
  personalEmail: z.union([z.string().trim().check(z.email()).toLowerCase(), z.literal("")]).optional(),
  location: z.string().trim().max(255).optional(),
  bio: z.string().trim().max(1000).optional(),
  birthDate: birthDateSchema.optional(),
  gender: z.enum(["", "male", "female", "other"]).optional(),
  address: z.strictObject({ street: z.string().trim().max(255), city: z.string().trim().max(50), state: z.string().trim().max(50) }).optional(),
});
export const shippingAddressSchema = z.strictObject({
  recipientName: z.string().trim().min(1).max(100),
  email: z.string().trim().check(z.email()).toLowerCase(),
  province: z.string().trim().min(1).max(100),
  ward: z.string().trim().min(1).max(100),
  street: z.string().trim().min(1).max(255),
  deliveryTime: z.string().trim().max(255).default(""),
});
export const customerOrdersQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;
export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;