import { z } from "zod";
import { objectId } from "./common.validation.js";

export const checkoutSchema = z.strictObject({
  requestId: z.uuid(),
  recipientName: z.string().trim().min(1, "Vui lòng nhập tên người nhận.").max(100),
  phone: z.string().trim().regex(/^(?:0|\+84)[0-9]{9}$/, "Số điện thoại Việt Nam không hợp lệ."),
  provinceCode: z.int().positive(),
  districtCode: z.int().positive(),
  wardCode: z.int().positive(),
  street: z.string().trim().min(1, "Vui lòng nhập địa chỉ nhà.").max(255),
  note: z.string().trim().max(1000).default(""),
  paymentMethod: z.literal("cod"),
  items: z.array(z.strictObject({
    productId: objectId,
    variantId: objectId.optional(),
    quantity: z.int().min(1).max(100000),
    expectedUnitPrice: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER / 100),
  })).min(1).max(100).superRefine((items, ctx) => {
    const keys = new Set<string>();
    items.forEach((item, index) => {
      const key = `${item.productId.toLowerCase()}:${item.variantId?.toLowerCase() ?? ""}`;
      if (keys.has(key)) ctx.addIssue({ code: "custom", path: [index], message: "Sản phẩm bị lặp trong đơn hàng." });
      keys.add(key);
    });
  }),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
