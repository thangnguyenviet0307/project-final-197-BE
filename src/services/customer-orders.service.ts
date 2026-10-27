import { Types } from "mongoose";
import { Order } from "../models/orders.model.js";
import { calculateOrderTotal } from "../utils/order-total.js";
import { buildPagination } from "../utils/pagination.js";

// Ownership comes exclusively from the authenticated Customer, never query/body input.
export async function listCustomerOrders(customerId: string, page: number, limit: number) {
  const scope = { customerId: new Types.ObjectId(customerId) };
  const [orders, total] = await Promise.all([
    Order.find(scope).select("orderCode orderStatus orderDate orderItems street city state paymentType shippingDate cancellationReason").sort({ orderDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(scope),
  ]);
  return { data: orders.map(order => ({
    _id: order._id, orderCode: order.orderCode, orderStatus: order.orderStatus, orderDate: order.orderDate,
    street: order.street, city: order.city, state: order.state, paymentType: order.paymentType,
    shippingDate: order.shippingDate, cancellationReason: order.cancellationReason,
    totalAmount: calculateOrderTotal(order.orderItems),
    orderItems: order.orderItems.map(item => ({ productName: item.productName, variantName: item.variantName, quantity: item.quantity, price: item.price, discount: item.discount })),
  })), pagination: buildPagination(page, limit, total) };
}