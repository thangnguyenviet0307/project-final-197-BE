import { sumVariantStock } from "../utils/inventory.js";
import createHttpError from "http-errors";
import { type QueryFilter, Types, type ClientSession } from "mongoose";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { assertActiveCatalog } from "../utils/catalog-reference.js";
import { calculateOrderTotal } from "../utils/order-total.js";
import { hasPermission } from "../config/rolePermissions.js";
import { Customer } from "../models/customers.model.js";
import { Order } from "../models/orders.model.js";
import Product from "../models/products.model.js";
import { User } from "../models/users.model.js";
import type { AuthUser } from "../types/auth.type.js";
import { Permission } from "../types/permissions.type.js";
import type { IOrder, IOrderItem } from "../types/orders.type.js";
import { OrderStatus, OPEN_ORDER_STATUSES } from "../types/orders.type.js";
import { buildPagination } from "../utils/pagination.js";
import type { CreateOrderInput, GetOrdersQuery, UpdateOrderStatusInput } from "../types/orders.type.js";

const STATUS_TRANSITIONS: Record<number, number[]> = {
  [OrderStatus.Pending]: [OrderStatus.Processing, OrderStatus.Rejected],
  [OrderStatus.Processing]: [OrderStatus.Completed, OrderStatus.Rejected],
  [OrderStatus.Rejected]: [], [OrderStatus.Completed]: [],
};
const needsAssignee = (status: number) => [OrderStatus.Processing, OrderStatus.Completed].includes(status);
const canAssign = (actor: AuthUser) => hasPermission(actor.role, Permission.OrderAssign);
const orderScope = (actor: AuthUser): QueryFilter<IOrder> =>
  hasPermission(actor.role, Permission.OrderViewAll) ? {} : {
    userId: { $in: [new Types.ObjectId(actor.id), null] },
  };
async function resolveAssignee(actor: AuthUser, requested?: string, session?: ClientSession) {
  if (!requested) return undefined;
  if (!canAssign(actor) && requested !== actor.id) throw createHttpError(403, "Cannot assign another user");
  const query = User.exists({ _id: requested, active: true });
  if (session) query.session(session);
  if (!(await query)) throw createHttpError(404, "Active user not found");
  return requested;
}
async function restoreStock(items: IOrderItem[], session: ClientSession) {
  // MongoDB transactions do not support parallel operations on the same session.
  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) throw createHttpError(409, "Cannot restore a deleted product");
    if (item.variantId) {
      const variant = product.variants.id(item.variantId);
      if (!variant) throw createHttpError(409, "Cannot restore a deleted variant");
      variant.stock += item.quantity;
      product.stock = sumVariantStock(product.variants);
    } else {
      if (product.variants.length) throw createHttpError(409, "Legacy order needs variant reconciliation before cancellation");
      product.stock += item.quantity;
    }
    await product.save({ session });
  }
}
export async function getOrders(actor: AuthUser, { page, limit, orderStatus, customerId, userId }: GetOrdersQuery) {
  const conditions: QueryFilter<IOrder>[] = [orderScope(actor)];
  if (orderStatus) conditions.push({ orderStatus });
  if (customerId) conditions.push({ customerId });
  if (userId) conditions.push({ userId });
  const filter: QueryFilter<IOrder> = { $and: conditions };
  const [data, total] = await Promise.all([
    Order.find(filter).sort({ orderDate: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("customerId", "firstName lastName email phone").populate("userId", "firstName lastName role"),
    Order.countDocuments(filter),
  ]);
  return { data, pagination: buildPagination(page, limit, total) };
}
export async function getOrderById(actor: AuthUser, id: string) {
  const order = await Order.findOne({ _id: id, ...orderScope(actor) })
    .populate("customerId", "firstName lastName email phone")
    .populate("userId", "firstName lastName role")
    .populate("orderItems.productId", "product_name slug thumbnail");
  if (!order) throw createHttpError(404, "Order not found");
  return order;
}
export async function createOrder(actor: AuthUser, input: CreateOrderInput) {
  if (!canAssign(actor) && input.userId && input.userId !== actor.id) throw createHttpError(403, "Cannot assign another user");
  if (input.requireDate && input.requireDate < new Date()) throw createHttpError(400, "Required date cannot precede order creation");
  return withRelationsTransaction(async (session) => {
    const userId = await resolveAssignee(actor, input.userId ?? (canAssign(actor) ? undefined : actor.id), session);
    const customer = await Customer.findOne({ _id: input.customerId, isActive: true }).session(session);
    if (!customer) {
      throw createHttpError(404, "Active customer not found");
    }
    const merged = new Map<string, { productId: string; variantId?: string; quantity: number }>();
    for (const item of input.orderItems) {
      const key = `${item.productId}:${item.variantId ?? ""}`;
      const current = merged.get(key);
      if (current) {
        current.quantity += item.quantity;
        if (!Number.isSafeInteger(current.quantity)) throw createHttpError(400, "Total quantity is too large");
      }
      else merged.set(key, { productId: item.productId, quantity: item.quantity,
        ...(item.variantId ? { variantId: item.variantId } : {}) });
    }
    const orderItems: IOrderItem[] = [];
    for (const item of merged.values()) {
      const product = await Product.findById(item.productId).session(session);
      if (!product || !product.is_active) throw createHttpError(404, "Active product not found");
      await assertActiveCatalog(product.brand, product.category, session);
      const variant = item.variantId ? product.variants.id(item.variantId) : null;
      if (product.variants.length && !item.variantId) throw createHttpError(400, "Select a product variant");
      if (item.variantId && !variant) throw createHttpError(404, "Variant not found");
      if ((variant?.stock ?? product.stock) < item.quantity) throw createHttpError(409, "Insufficient stock");
      if (variant) {
        variant.stock -= item.quantity;
        product.stock = sumVariantStock(product.variants);
      } else product.stock -= item.quantity;
      await product.save({ session });
      orderItems.push({ productId: product._id, quantity: item.quantity,
        price: variant?.price ?? product.price, discount: product.discount,
        ...(variant ? { variantId: variant._id, sku: variant.sku } : {}) });
    }
    calculateOrderTotal(orderItems);
    const order = new Order({ ...input, customerId: new Types.ObjectId(input.customerId),
      customerSnapshot: { firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone },
      ...(userId ? { userId: new Types.ObjectId(userId) } : {}), orderItems, orderStatus: OrderStatus.Pending });
    await order.save({ session });
    return order;
  });
}
export async function updateOrderStatus(actor: AuthUser, id: string, input: UpdateOrderStatusInput) {
  return withRelationsTransaction(async (session) => {
    const order = await Order.findOne({ _id: id, ...orderScope(actor) }).session(session);
    if (!order) throw createHttpError(404, "Order not found");
    if (!STATUS_TRANSITIONS[order.orderStatus]?.includes(input.orderStatus)) {
      const current = OrderStatus[order.orderStatus] ?? String(order.orderStatus);
      const requested = OrderStatus[input.orderStatus] ?? String(input.orderStatus);
      const allowed = STATUS_TRANSITIONS[order.orderStatus] ?? [];
      const guidance = allowed.length
        ? `Allowed next statuses: ${allowed.map((status) => `${OrderStatus[status]} (${status})`).join(', ')}.`
        : 'This order is final. Create a new order to test another workflow.';
      throw createHttpError(409,
        `Cannot change order from ${current} (${order.orderStatus}) to ${requested} (${input.orderStatus}). ${guidance}`);
    }
    let userId = input.userId ?? order.userId?.toString();
    if (!userId && !canAssign(actor)) userId = actor.id;
    if (needsAssignee(input.orderStatus) && !userId) throw createHttpError(400, "Assign an order handler first");
    if (userId && (input.userId || needsAssignee(input.orderStatus))) {
      await resolveAssignee(actor, userId, session);
    }
    const fields: Partial<IOrder> = { orderStatus: input.orderStatus };
    if (input.shippingDate && (input.orderStatus !== OrderStatus.Completed || input.shippingDate < order.orderDate || input.shippingDate > new Date())) {
      throw createHttpError(400, "Shipping date must be a completion timestamp between order creation and now");
    }
    if (userId) fields.userId = new Types.ObjectId(userId);
    if (input.shippingDate) fields.shippingDate = input.shippingDate;
    else if (input.orderStatus === OrderStatus.Completed && !order.shippingDate) fields.shippingDate = new Date();
    const updated = await Order.findOneAndUpdate(
      { _id: id, ...orderScope(actor), orderStatus: order.orderStatus }, { $set: fields },
      { new: true, session, runValidators: true });
    if (!updated) throw createHttpError(409, "Order changed; please retry");
    if (input.orderStatus === OrderStatus.Rejected) await restoreStock(order.orderItems, session);
    return updated;
  });
}
export async function deleteOrder(id: string) {
  const order = await Order.findOneAndDelete({ _id: id, orderStatus: OrderStatus.Rejected });
  if (!order) {
    if (!(await Order.exists({ _id: id }))) throw createHttpError(404, "Order not found");
    throw createHttpError(409, "Only rejected orders can be deleted");
  }
}

export async function assignOrder(actor: AuthUser, id: string, requested: string) {
  if (!canAssign(actor)) throw createHttpError(403, "Cannot assign another user");
  return withRelationsTransaction(async (session) => {
    const order = await Order.findById(id).session(session);
    if (!order) throw createHttpError(404, "Order not found");
    if (!OPEN_ORDER_STATUSES.includes(order.orderStatus)) {
      throw createHttpError(409, "Only open orders can be reassigned");
    }
    await resolveAssignee(actor, requested, session);
    order.userId = new Types.ObjectId(requested);
    await order.save({ session });
    return order;
  });
}

export async function getPersonalSales(actor: AuthUser) {
  if (!hasPermission(actor.role, Permission.OrderView)) throw createHttpError(403, "Access denied");
  const cursor = Order.find({ userId: new Types.ObjectId(actor.id), orderStatus: OrderStatus.Completed })
    .select("orderItems").cursor();
  let completedOrders = 0;
  let cents = 0n;
  for await (const order of cursor) {
    completedOrders++;
    cents += BigInt(Math.round(calculateOrderTotal(order.orderItems) * 100));
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw createHttpError(400, "Sales total is too large");
  return { completedOrders, revenue: Number(cents) / 100 };
}
