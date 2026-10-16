import createHttpError from 'http-errors';
import { type QueryFilter, Types } from 'mongoose';
import { hasPermission } from '../config/rolePermissions.js';
import { Customer } from '../models/customer.model.js';
import { Order } from '../models/order.model.js';
import Product from '../models/product.model.js';
import { User } from '../models/user.model.js';
import type { AuthUser } from '../types/auth.type.js';
import { Permission } from '../types/permission.type.js';
import type { IOrder, IOrderItem } from '../types/order.type.js';
import { OrderStatus, PaymentType } from '../types/order.type.js';
import { buildPagination } from '../utils/pagination.js';
import type {
  CreateOrderInput,
  GetOrdersQuery,
  UpdateOrderStatusInput,
} from '../validations/order.validation.js';

// Các bước chuyển trạng thái hợp lệ
const STATUS_TRANSITIONS: Record<number, number[]> = {
  [OrderStatus.Pending]: [OrderStatus.Processing, OrderStatus.Rejected],
  [OrderStatus.Processing]: [OrderStatus.Completed, OrderStatus.Rejected],
  [OrderStatus.Rejected]: [],
  [OrderStatus.Completed]: [],
};

type StockItem = Pick<IOrderItem, 'productId' | 'quantity'>;

/**
 * Phạm vi đơn hàng được xem theo quyền:
 *  - Có orders:view-all (Admin): tất cả đơn
 *  - Còn lại (Staff): đơn của mình + đơn chưa có người phụ trách ($in [id, null] khớp cả trường không tồn tại)
 */
const canAssign = (actor: AuthUser) => hasPermission(actor.role, Permission.OrderAssign);

const orderScope = (actor: AuthUser): QueryFilter<IOrder> =>
  hasPermission(actor.role, Permission.OrderViewAll)
    ? {}
    : {
        userId: {
          $in: [new Types.ObjectId(actor.id), null],
        },
      };

// Người có orders:assign (Admin) gán cho bất kỳ user đang hoạt động; người khác chỉ được nhận đơn cho chính mình
async function resolveAssignee(actor: AuthUser, requested?: string) {
  if (!requested) return undefined;
  if (!canAssign(actor) && requested !== actor.id) {
    throw createHttpError(403, 'Bạn chỉ được nhận đơn cho chính mình');
  }
  if (!(await User.exists({ _id: requested, active: true }))) {
    throw createHttpError(404, 'Không tìm thấy người dùng đang hoạt động');
  }
  return requested;
}

async function restoreStock(items: StockItem[]) {
  await Promise.all(
    items.map((i) => Product.updateOne({ _id: i.productId }, { $inc: { stock: i.quantity } })),
  );
}

export async function getOrders(
  actor: AuthUser,
  { page, limit, orderStatus, customerId, userId }: GetOrdersQuery,
) {
  const conditions: QueryFilter<IOrder>[] = [orderScope(actor)];
  if (orderStatus) conditions.push({ orderStatus });
  if (customerId) conditions.push({ customerId });
  if (userId) conditions.push({ userId });
  const filter: QueryFilter<IOrder> = { $and: conditions };

  const [data, total] = await Promise.all([
    Order.find(filter)
      .sort({ orderDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customerId', 'firstName lastName email phone')
      .populate('userId', 'firstName lastName role'),
    Order.countDocuments(filter),
  ]);
  return { data, pagination: buildPagination(page, limit, total) };
}

export async function getOrderById(actor: AuthUser, id: string) {
  const order = await Order.findOne({ _id: id, ...orderScope(actor) })
    .populate('customerId', 'firstName lastName email phone')
    .populate('userId', 'firstName lastName role')
    .populate('orderItems.productId', 'productName slug thumbnail');
  if (!order) throw createHttpError(404, 'Không tìm thấy đơn hàng');
  return order;
}

export async function createOrder(actor: AuthUser, input: CreateOrderInput) {
  if (!(await Customer.exists({ _id: input.customerId }))) {
    throw createHttpError(404, 'Không tìm thấy khách hàng');
  }

  // Người không có quyền gán đơn (Staff) tạo đơn thì tự động phụ trách đơn đó
  const userId = await resolveAssignee(
    actor,
    input.userId ?? (canAssign(actor) ? undefined : actor.id),
  );

  // Gộp các dòng trùng productId
  const merged = new Map<string, number>();
  for (const item of input.orderItems) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }

  const reserved: StockItem[] = [];
  const orderItems: IOrderItem[] = [];

  try {
    for (const [productId, quantity] of merged) {
      // Trừ kho nguyên tử: chỉ thành công khi còn đủ hàng (tránh bán vượt tồn kho khi đặt đồng thời)
      const product = await Product.findOneAndUpdate(
        { _id: productId, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: true },
      );
      if (!product) {
        const exists = await Product.exists({ _id: productId });
        throw exists
          ? createHttpError(409, `Sản phẩm ${productId} không đủ tồn kho`)
          : createHttpError(404, `Không tìm thấy sản phẩm ${productId}`);
      }
      reserved.push({ productId: product._id, quantity });
      // Lưu snapshot giá/discount tại thời điểm đặt hàng
      orderItems.push({
        productId: product._id,
        quantity,
        price: product.price,
        discount: product.discount,
      });
    }

    const orderData: Record<string, unknown> = {
      customerId: new Types.ObjectId(input.customerId),
      orderStatus: OrderStatus.Pending,
      orderNote: input.orderNote,
      street: input.street,
      city: input.city,
      state: input.state,
      paymentType: input.paymentType as PaymentType,
      orderItems,
    };
    if (userId) orderData['userId'] = new Types.ObjectId(userId);
    if (input.requireDate) orderData['requireDate'] = input.requireDate;

    return await Order.create(orderData);
  } catch (err) {
    await restoreStock(reserved); // hoàn kho nếu có lỗi giữa chừng
    throw err;
  }
}

export async function updateOrderStatus(
  actor: AuthUser,
  id: string,
  input: UpdateOrderStatusInput,
) {
  const order = await Order.findOne({ _id: id, ...orderScope(actor) });
  if (!order) throw createHttpError(404, 'Không tìm thấy đơn hàng');

  const currentStatus = order.orderStatus as number;
  const newStatus = input.orderStatus as number;
  if (!STATUS_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    throw createHttpError(
      409,
      `Không thể chuyển trạng thái từ ${currentStatus} sang ${newStatus}`,
    );
  }

  let userId = (await resolveAssignee(actor, input.userId)) ?? order.userId?.toString();
  // Người không có quyền gán đơn (Staff) xử lý đơn chưa có người phụ trách thì tự nhận đơn đó
  if (!userId && !canAssign(actor)) userId = actor.id;
  if (newStatus === OrderStatus.Processing && !userId) {
    throw createHttpError(400, 'Cần chỉ định người xử lý khi chuyển sang Processing');
  }

  const $set: Partial<IOrder> = { orderStatus: newStatus };
  if (userId) $set.userId = new Types.ObjectId(userId);
  if (input.shippingDate) {
    $set.shippingDate = input.shippingDate;
  } else if (newStatus === OrderStatus.Completed && !order.shippingDate) {
    $set.shippingDate = new Date();
  }

  // Điều kiện orderStatus hiện tại giúp tránh 2 request đổi trạng thái cùng lúc
  const updated = await Order.findOneAndUpdate(
    { _id: id, orderStatus: currentStatus },
    { $set },
    { new: true },
  );
  if (!updated) {
    throw createHttpError(409, 'Đơn hàng vừa được cập nhật bởi người khác, vui lòng tải lại');
  }

  if (newStatus === OrderStatus.Rejected) await restoreStock(order.orderItems);
  return updated;
}

// Chỉ Admin (kiểm ở route), và chỉ xoá được đơn đã Rejected (kho đã được hoàn)
export async function deleteOrder(id: string) {
  const order = await Order.findById(id);
  if (!order) throw createHttpError(404, 'Không tìm thấy đơn hàng');
  if ((order.orderStatus as number) !== OrderStatus.Rejected) {
    throw createHttpError(409, 'Chỉ được xoá đơn hàng ở trạng thái Rejected');
  }
  await order.deleteOne();
}