import { z } from "zod";
import { objectId } from "./common.validation.js";

export const checkoutSchema = z.strictObject({
  requestId: z.uuid(),
  recipientName: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^(?:0|\+84)[0-9]{9}$/),
  provinceCode: z.int().positive(),
  districtCode: z.int().positive(),
  wardCode: z.int().positive(),
  street: z.string().trim().min(1).max(255),
  note: z.string().trim().max(1000),
  paymentMethod: z.literal("cod"),
  items: z.array(z.strictObject({
    productId: objectId,
    variantId: objectId.optional(),
    quantity: z.int().positive().refine(Number.isSafeInteger),
    expectedUnitPrice: z.number().finite().nonnegative(),
  })).min(1).max(100),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
