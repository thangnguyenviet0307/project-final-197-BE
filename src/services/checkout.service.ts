import { createHash } from "node:crypto";
import createHttpError from "http-errors";
import { Types } from "mongoose";
import { Order } from "../models/orders.model.js";
import { Customer } from "../models/customers.model.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { generateOrderCode, isOrderCodeCollision } from "../utils/order-code.js";
import { calculateOrderTotal } from "../utils/order-total.js";
import { reserveOrderItems } from "./order-reservation.service.js";
import { resolveCheckoutAddress } from "./checkout-locations.service.js";
import type { CheckoutInput } from "../validations/checkout.validation.js";

export async function checkout(customerId: string | null, tokenVersion: number, input: CheckoutInput) {
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await withRelationsTransaction(async session => {
        const customer = customerId ? await Customer.findOne({ _id: customerId, isActive: true, accountEnabled: true }).select("+tokenVersion").session(session) : null;
        if (customerId && (!customer || (customer.tokenVersion ?? 0) !== tokenVersion)) throw createHttpError(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        const existing = await Order.findOne({ customerId, checkoutRequestId: input.requestId }).select("+checkoutFingerprint").session(session);
        if (existing) {
          if (existing.checkoutFingerprint !== fingerprint) throw createHttpError(409, "Yêu cầu này đã được sử dụng. Vui lòng kiểm tra lịch sử đơn hàng.");
          return { _id: existing._id.toString(), orderCode: existing.orderCode, totalAmount: calculateOrderTotal(existing.orderItems), orderStatus: existing.orderStatus };
        }
        const address = await resolveCheckoutAddress(input.provinceCode, input.districtCode, input.wardCode);
        const orderItems = await reserveOrderItems(input.items, session);
        const order = new Order({
          customerId: customerId ? new Types.ObjectId(customerId) : null,
          ...(!customerId ? { guestCheckout: true } : {}), orderCode: generateOrderCode(), orderStatus: 1,
          checkoutRequestId: input.requestId, checkoutFingerprint: fingerprint,
          customerSnapshot: customer ? { firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone }
            : { firstName: input.recipientName, lastName: "", email: "", phone: input.phone },
          recipientName: input.recipientName, recipientPhone: input.phone,
          street: input.street, city: `${address.ward}, ${address.district}`, state: address.province,
          deliveryAddress: { ...address, provinceCode: input.provinceCode, districtCode: input.districtCode, wardCode: input.wardCode },
          orderNote: input.note, paymentType: 1, orderItems,
        });
        await order.save({ session });
        // Complete missing contact details atomically; preserve existing profiles.
        if (customer && !customer.phone?.trim()) customer.phone = input.phone;
        if (customer && !customer.shippingAddress) {
          customer.shippingAddress = {
            recipientName: input.recipientName, email: customer.email,
            province: address.province, district: address.district, ward: address.ward,
            street: input.street, deliveryTime: "",
          };
        }
        if (customer?.isModified()) await customer.save({ session });
        return { _id: order._id.toString(), orderCode: order.orderCode, totalAmount: calculateOrderTotal(orderItems), orderStatus: order.orderStatus };
      });
    } catch (error) {
      if (!isOrderCodeCollision(error) || attempt === 4) throw error;
    }
  }
  throw createHttpError(503, "Không tạo được mã đơn hàng. Vui lòng thử lại.");
}
