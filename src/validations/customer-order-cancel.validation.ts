import { z } from "zod";
export const cancelCustomerOrderSchema = z.strictObject({
  cancellationReason: z.string().trim().min(1, "Vui lòng nhập lý do hủy đơn.").max(1000, "Lý do hủy tối đa 1000 ký tự."),
});
