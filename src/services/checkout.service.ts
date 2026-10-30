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
  return receipt.result;
}

export async function createCheckout(customerId: string, raw: CheckoutInput) {
  const input = checkoutSchema.parse(raw);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const scope = { customerId: new Types.ObjectId(customerId), requestId: input.requestId };
  // A replay should still work when the catalog or locality provider is offline.
  const receipt = await CheckoutRequest.findOne(scope).select("+payloadHash");
  if (receipt) return replay(receipt, hash);
  const address = await resolveCheckoutAddress(input);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await withRelationsTransaction(async session => {
        const existing = await CheckoutRequest.findOne(scope).select("+payloadHash").session(session);
        if (existing) return replay(existing, hash);
        const customer = await Customer.findOne({ _id: customerId, isActive: true, accountEnabled: true }).session(session);
        if (!customer || customer.mustChangePassword) throw createHttpError(403, "Enabled customer account required");
        const orderItems = await reserveOrderItems(input.items, session);
        const order = new Order({
          customerId: scope.customerId, orderCode: generateOrderCode(), orderStatus: 1, paymentType: 1,
          customerSnapshot: { firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone },
          recipientName: input.recipientName, recipientPhone: input.phone,
          deliveryAddress: { ...address, provinceCode: input.provinceCode, districtCode: input.districtCode, wardCode: input.wardCode },
          street: input.street, city: address.district, state: address.province,
          orderNote: input.note, orderItems,
        });
        await order.save({ session });
        const result = { _id: order._id, orderCode: order.orderCode!, totalAmount: calculateOrderTotal(orderItems), orderStatus: order.orderStatus };
        await new CheckoutRequest({ ...scope, payloadHash: hash, result }).save({ session });
        return result;
      });
    } catch (error) {
      if (!isOrderCodeCollision(error)) throw error;
      if (attempt === 4) throw createHttpError(503, "Could not allocate order code; retry later");
    }
  }
  throw createHttpError(503, "Checkout unavailable");
}
