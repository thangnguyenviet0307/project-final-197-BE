import { Types } from "mongoose";
import { Order } from "../models/orders.model.js";
import { calculateOrderTotal } from "../utils/order-total.js";
import { buildPagination } from "../utils/pagination.js";
import createHttpError from "http-errors";
import { Customer } from "../models/customers.model.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { restoreOrderStock } from "./order-reservation.service.js";
import { OrderStatus } from "../types/orders.type.js";

export async function cancelCustomerOrder(customerId: string, tokenVersion: number, id: string, cancellationReason: string) {
  cancellationReason = cancellationReason.trim();
  if (!cancellationReason || cancellationReason.length > 1000) throw createHttpError(400, "Enter a cancellation reason (1-1000 characters).");
  return withRelationsTransaction(async session => {
    const customer = await Customer.findOne({ _id: customerId, isActive: true, accountEnabled: true }).select("+tokenVersion").session(session);
    if (!customer || (customer.tokenVersion ?? 0) !== tokenVersion) throw createHttpError(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    const scope = { _id: id, customerId: new Types.ObjectId(customerId) };
    const order = await Order.findOne(scope).session(session);
    if (!order) throw createHttpError(404, "Không tìm thấy đơn hàng của bạn.");
    if (order.orderStatus === OrderStatus.Rejected && order.cancelledByCustomer) return { _id: order._id, orderStatus: order.orderStatus, cancelledByCustomer: true };
    if (order.orderStatus !== OrderStatus.Pending) throw createHttpError(409, "Chỉ có thể hủy đơn đang chờ xử lý. Vui lòng cập nhật lại danh sách đơn hàng.");
    const updated = await Order.findOneAndUpdate({ ...scope, orderStatus: OrderStatus.Pending },
      { $set: { orderStatus: OrderStatus.Rejected, cancelledByCustomer: true, cancellationReason } },
      { returnDocument: "after", session, runValidators: true });
    if (!updated) throw createHttpError(409, "Trạng thái đơn hàng đã thay đổi. Vui lòng cập nhật lại danh sách.");
    await restoreOrderStock(order.orderItems, session);
    return { _id: updated._id, orderStatus: updated.orderStatus, cancelledByCustomer: true };
  });
}

// Ownership comes exclusively from the authenticated Customer, never query/body input.
export async function listCustomerOrders(customerId: string, page: number, limit: number) {
  const scope = { customerId: new Types.ObjectId(customerId) };
  const [orders, total] = await Promise.all([
    Order.find(scope).select("orderCode orderStatus orderDate orderItems street city state deliveryAddress paymentType shippingDate cancellationReason cancelledByCustomer recipientName recipientPhone").sort({ orderDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(scope),
  ]);
  return { data: orders.map(order => ({
    _id: order._id, orderCode: order.orderCode, orderStatus: order.orderStatus, orderDate: order.orderDate,
    street: order.street, city: order.city, state: order.state, paymentType: order.paymentType,
    deliveryAddress: order.deliveryAddress, shippingDate: order.shippingDate, cancellationReason: order.cancellationReason,
    cancelledByCustomer: order.cancelledByCustomer, recipientName: order.recipientName, recipientPhone: order.recipientPhone,
    totalAmount: calculateOrderTotal(order.orderItems),
    orderItems: order.orderItems.map(item => ({ productName: item.productName, variantName: item.variantName, quantity: item.quantity, price: item.price, discount: item.discount })),
  })), pagination: buildPagination(page, limit, total) };
}
