import { createHash } from "node:crypto";
import { Types } from "mongoose";
import createHttpError from "http-errors";
import { Customer } from "../models/customers.model.js";
import { Order } from "../models/orders.model.js";
import { CheckoutRequest, type CheckoutReceipt } from "../models/checkout-requests.model.js";
import { checkoutSchema, type CheckoutInput } from "../validations/checkout.validation.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { calculateOrderTotal } from "../utils/order-total.js";
import { generateOrderCode, isOrderCodeCollision } from "../utils/order-code.js";
import { reserveOrderItems } from "./order-reservation.service.js";
import { resolveCheckoutAddress } from "./checkout-locations.service.js";

function replay(receipt: CheckoutReceipt, hash: string) {
  if (receipt.payloadHash !== hash) throw createHttpError(409, "Request ID already used with different checkout data");
  if (receipt.reservationExpiredAt) throw createHttpError(409, "Đơn hàng đã hết thời hạn chờ xác nhận 24 giờ và đã được hoàn tồn. Vui lòng kiểm tra giỏ hàng trước khi đặt lại.", { businessCode: "CHECKOUT_RESERVATION_EXPIRED" });
  return { _id: receipt.result._id.toString(), orderCode: receipt.result.orderCode, totalAmount: receipt.result.totalAmount, orderStatus: receipt.result.orderStatus };
}

export async function checkout(customerId: string | null, tokenVersion: number, input: CheckoutInput) {
  return performCheckout(customerId, input, tokenVersion);
}

// Compatibility for existing internal callers; HTTP checkout verifies tokenVersion.
export async function createCheckout(customerId: string, input: CheckoutInput) {
  return performCheckout(customerId, input);
}

async function performCheckout(customerId: string | null, raw: CheckoutInput, tokenVersion?: number) {
  const input = checkoutSchema.parse(raw);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const scope = { customerId: customerId ? new Types.ObjectId(customerId) : null, requestId: input.requestId };
  let address: Awaited<ReturnType<typeof resolveCheckoutAddress>> | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await withRelationsTransaction(async session => {
        const customer = customerId ? await Customer.findOne({ _id: customerId, isActive: true, accountEnabled: true }).select("+tokenVersion").session(session) : null;
        if (customerId && (!customer || customer.mustChangePassword || (tokenVersion !== undefined && (customer.tokenVersion ?? 0) !== tokenVersion))) {
          throw createHttpError(tokenVersion === undefined ? 403 : 401, "Enabled customer session required");
        }
        const existing = await CheckoutRequest.findOne(scope).select("+payloadHash").session(session);
        if (existing) return replay(existing, hash);
        // Read older stage confirmations too; never reserve an existing request again.
        const legacy = await Order.findOne({ customerId: scope.customerId, checkoutRequestId: input.requestId }).select("+checkoutFingerprint").session(session);
        if (legacy) {
          if (legacy.checkoutFingerprint !== hash) throw createHttpError(409, "Request ID already used with different checkout data");
          const result = { _id: legacy._id, orderCode: legacy.orderCode!, totalAmount: calculateOrderTotal(legacy.orderItems), orderStatus: legacy.orderStatus };
          await new CheckoutRequest({ ...scope, payloadHash: hash, result }).save({ session });
          return { ...result, _id: result._id.toString() };
        }
        // Finish the read/replay pass before waiting on an external provider.
        // The next pass rechecks session and receipts under the lock.
        if (!address) return null;
        const orderItems = await reserveOrderItems(input.items, session);
        const order = new Order({
          customerId: scope.customerId, ...(!customerId ? { guestCheckout: true } : {}),
          ...(!customerId ? { reservationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } : {}),
          checkoutRequestId: input.requestId, checkoutFingerprint: hash,
          orderCode: generateOrderCode(), orderStatus: 1, paymentType: 1,
          customerSnapshot: customer ? { firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone }
            : { firstName: input.recipientName, lastName: "", email: "", phone: input.phone },
          recipientName: input.recipientName, recipientPhone: input.phone,
          deliveryAddress: { ...address, provinceCode: input.provinceCode, districtCode: input.districtCode, wardCode: input.wardCode },
          street: input.street, city: `${address.ward}, ${address.district}`, state: address.province,
          orderNote: input.note, orderItems,
        });
        await order.save({ session });
        if (customer && tokenVersion !== undefined) {
          if (!customer.phone?.trim()) customer.phone = input.phone;
          if (!customer.shippingAddress) customer.shippingAddress = {
            recipientName: input.recipientName, email: customer.email,
            province: address.province, district: address.district, ward: address.ward,
            street: input.street, deliveryTime: "",
          };
          if (customer.isModified()) await customer.save({ session });
        }
        const result = { _id: order._id, orderCode: order.orderCode!, totalAmount: calculateOrderTotal(orderItems), orderStatus: order.orderStatus };
        await new CheckoutRequest({ ...scope, payloadHash: hash, result }).save({ session });
        return { ...result, _id: result._id.toString() };
      });
      if (result === null) {
        address = await resolveCheckoutAddress(input);
        attempt--;
        continue;
      }
      return result;
    } catch (error) {
      if (!isOrderCodeCollision(error)) throw error;
      if (attempt === 4) throw createHttpError(503, "Could not allocate order code; retry later");
    }
  }
  throw createHttpError(503, "Checkout unavailable");
}
