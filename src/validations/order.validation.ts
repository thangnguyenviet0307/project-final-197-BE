import { z } from 'zod';
import { OrderStatus, PaymentType } from '../types/orders.type.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ObjectId không hợp lệ');

export const orderItemSchema = z.object({
  productId: objectId,
  quantity: z.number().int().min(0),
  price: z.number().min(0),
  discount: z.number().min(0).max(70).default(0),
});

export const createOrderSchema = z.object({
  customerId: objectId,
  orderStatus: z.enum(OrderStatus).default(OrderStatus.Pending),
  requireDate: z.coerce.date().optional(),
  shippingDate: z.coerce.date().optional(),
  staffId: objectId.optional(),
  orderNote: z.string().optional(),
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(50),
  state: z.string().min(1).max(50),
  paymentType: z.enum(PaymentType),
  orderItems: z.array(orderItemSchema).min(1, 'Đơn hàng phải có ít nhất 1 sản phẩm'),
});

export const updateOrderStatusSchema = z.object({
  orderStatus: z.enum(OrderStatus),
  shippingDate: z.coerce.date().optional(),
  staffId: objectId.optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;