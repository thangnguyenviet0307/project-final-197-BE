import { z } from 'zod';
import { objectId, paginationSchema } from './common.validation.js';
import { OrderStatus, PaymentType } from '../types/order.type.js';

const orderStatusValues = Object.values(OrderStatus).filter((v): v is number => typeof v === 'number');
const paymentTypeValues = Object.values(PaymentType).filter((v): v is number => typeof v === 'number');

// Giá và discount KHÔNG nhận từ client: server lấy từ Product để tránh bị sửa giá
export const orderItemSchema = z.object({
  productId: objectId,
  quantity: z.number().int().min(1, 'Số lượng phải >= 1'),
});

export const createOrderSchema = z.object({
  customerId: objectId,
  userId: objectId.optional(), // chỉ Admin được chỉ định; Staff luôn là chính mình
  requireDate: z.coerce.date().optional(),
  orderNote: z.string().optional(),
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(50),
  state: z.string().min(1).max(50),
  paymentType: z.number().refine((val) => paymentTypeValues.includes(val), {
    message: 'Loại thanh toán không hợp lệ',
  }),
  orderItems: z.array(orderItemSchema).min(1, 'Đơn hàng phải có ít nhất 1 sản phẩm'),
});

export const updateOrderStatusSchema = z.object({
  orderStatus: z.number().refine((val) => orderStatusValues.includes(val), {
    message: 'Trạng thái đơn hàng không hợp lệ',
  }),
  shippingDate: z.coerce.date().optional(),
  userId: objectId.optional(),
});

export const getOrdersQuerySchema = paginationSchema.extend({
  orderStatus: z.coerce.number().int().min(1).max(4).optional(),
  customerId: objectId.optional(),
  userId: objectId.optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type GetOrdersQuery = z.infer<typeof getOrdersQuerySchema>;