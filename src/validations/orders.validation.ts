import type { OrderItemInput, CreateOrderInput, UpdateOrderStatusInput, GetOrdersQuery, AssignOrderInput } from "../types/orders.type.js";
export type { OrderItemInput, CreateOrderInput, UpdateOrderStatusInput, GetOrdersQuery, AssignOrderInput } from "../types/orders.type.js";
import { z } from 'zod';
import { objectId, paginationSchema, createAddressSchema } from './common.validation.js';
import { OrderStatus, PaymentType } from '../types/orders.type.js';

const orderStatusValues = Object.values(OrderStatus).filter((v): v is number => typeof v === 'number');
const paymentTypeValues = Object.values(PaymentType).filter((v): v is number => typeof v === 'number');
const orderDateSchema = z.union([z.string().trim().min(1), z.date()]).pipe(z.coerce.date());

// Giá và discount KHÔNG nhận từ client: server lấy từ Product để tránh bị sửa giá
const orderStatusSchema = z.number().refine((val) => orderStatusValues.includes(val), {
    message: 'Trạng thái đơn hàng không hợp lệ',
  });

export const orderItemSchema = z.object({
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.number().int().min(1, 'Số lượng phải >= 1'),
}) satisfies z.ZodType<OrderItemInput>;

export const createOrderSchema = z.object({
  customerId: objectId,
  userId: objectId.optional(), // chỉ Admin được chỉ định; Staff luôn là chính mình
  requireDate: orderDateSchema.optional(),
  orderNote: z.string().trim().max(2000).optional(),
  ...createAddressSchema().shape,
  paymentType: z.number().refine((val) => paymentTypeValues.includes(val), {
    message: 'Loại thanh toán không hợp lệ',
  }),
  orderItems: z.array(orderItemSchema).min(1, 'Đơn hàng phải có ít nhất 1 sản phẩm'),
}) satisfies z.ZodType<CreateOrderInput>;

export const updateOrderStatusSchema = z.object({
  orderStatus: orderStatusSchema,
  shippingDate: orderDateSchema.optional(),
  userId: objectId.optional(),
}) satisfies z.ZodType<UpdateOrderStatusInput>;

export const startOrderSchema = z.object({ userId: objectId.optional() }).strict();
export const getOrdersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  dateFrom: z.string().datetime({ offset: true }).pipe(z.coerce.date()).optional(),
  dateTo: z.string().datetime({ offset: true }).pipe(z.coerce.date()).optional(),
  orderStatus: z.coerce.number().pipe(orderStatusSchema).optional(),
  customerId: objectId.optional(),
  userId: objectId.optional(),
}).refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { message: 'Start date must not exceed end date', path: ['dateTo'] }) satisfies z.ZodType<GetOrdersQuery>;
export const assignOrderSchema = z.object({ userId: objectId }) satisfies z.ZodType<AssignOrderInput>;

export const updateOrderDatesSchema = z.object({
  requireDate: z.string().datetime({ offset: true }).pipe(z.coerce.date()).nullable().optional(),
  plannedShippingDate: z.string().datetime({ offset: true }).pipe(z.coerce.date()).nullable().optional(),
  shippingDate: z.string().datetime({ offset: true }).pipe(z.coerce.date()).optional(),
}).strict().refine(value => Object.keys(value).length > 0, { message: 'Select at least one date field' });