import createHttpError from "http-errors";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { restoreStock } from "./orders.services.js";
import { Types } from "mongoose";
import { Order } from "../models/orders.model.js";
import { calculateOrderTotal } from "../utils/order-total.js";
import { buildPagination } from "../utils/pagination.js";

// Ownership comes exclusively from the authenticated Customer, never query/body input.
export async function listCustomerOrders(customerId: string, page: number, limit: number) {
  const scope = { customerId: new Types.ObjectId(customerId) };
  const [orders, total] = await Promise.all([
    Order.find(scope).select("orderCode orderStatus orderDate orderItems street city state deliveryAddress recipientName recipientPhone paymentType shippingDate cancellationReason").sort({ orderDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(scope),
  ]);
  return { data: orders.map(order => ({
    _id: order._id, orderCode: order.orderCode, orderStatus: order.orderStatus, orderDate: order.orderDate,
    street: order.street, city: order.city, state: order.state, paymentType: order.paymentType,
    deliveryAddress: order.deliveryAddress, recipientName: order.recipientName, recipientPhone: order.recipientPhone,
    shippingDate: order.shippingDate, cancellationReason: order.cancellationReason,
    totalAmount: calculateOrderTotal(order.orderItems),
    orderItems: order.orderItems.map(item => ({ productName: item.productName, variantName: item.variantName, quantity: item.quantity, price: item.price, discount: item.discount })),
  })), pagination: buildPagination(page, limit, total) };
}
// Scope every read/write to the session owner and serialize stock restoration with status.
export async function cancelCustomerOrder(customerId: string, id: string, cancellationReason: string) {
  const reason = cancellationReason.trim();
  if (!reason || reason.length > 1000) throw createHttpError(400, "Enter a cancellation reason (1-1000 characters).");
  await withRelationsTransaction(async session => {
    const scope = { _id: id, customerId: new Types.ObjectId(customerId) };
    const order = await Order.findOne(scope).session(session);
    if (!order) throw createHttpError(404, "Order not found");
    if (![1, 2].includes(order.orderStatus)) throw createHttpError(409, "Only open orders can be cancelled");
    const updated = await Order.findOneAndUpdate({ ...scope, orderStatus: order.orderStatus },
      { $set: { orderStatus: 3, cancellationReason: reason } }, { session, runValidators: true, returnDocument: 'after' });
    if (!updated) throw createHttpError(409, "Order changed; refresh and try again");
    await restoreStock(order.orderItems, session);
  });
}
