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
    error: 'Trạng thái đơn hàng không hợp lệ',
  });

export const orderItemSchema = z.object({
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.int().min(1, 'Số lượng phải >= 1'),
}) satisfies z.ZodType<OrderItemInput>;

export const createOrderSchema = z.object({
  customerId: objectId,
  userId: objectId.optional(), // chỉ Admin được chỉ định; Staff luôn là chính mình
  requireDate: orderDateSchema.optional(),
  orderNote: z.string().trim().max(2000).optional(),
  ...createAddressSchema().shape,
  paymentType: z.number().refine((val) => paymentTypeValues.includes(val), {
    error: 'Loại thanh toán không hợp lệ',
  }),
  orderItems: z.array(orderItemSchema).min(1, 'Đơn hàng phải có ít nhất 1 sản phẩm'),
}) satisfies z.ZodType<CreateOrderInput>;

export const updateOrderStatusSchema = z.strictObject({
  cancellationReason: z.string().trim().min(1, "Enter a cancellation reason.").max(1000).optional(),
  orderStatus: orderStatusSchema,
  shippingDate: orderDateSchema.optional(),
  userId: objectId.optional(),
}) satisfies z.ZodType<UpdateOrderStatusInput>;

export const startOrderSchema = z.strictObject({ userId: objectId.optional() });
export const getOrdersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  dateFrom: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional(),
  dateTo: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional(),
  orderStatus: z.coerce.number().pipe(orderStatusSchema).optional(),
  customerId: objectId.optional(),
  userId: objectId.optional(),
}).refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { error: 'Start date must not exceed end date', path: ['dateTo'] }) satisfies z.ZodType<GetOrdersQuery>;
export const assignOrderSchema = z.object({ userId: objectId }) satisfies z.ZodType<AssignOrderInput>;

export const updateOrderDatesSchema = z.strictObject({
  requireDate: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).nullable().optional(),
  plannedShippingDate: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).nullable().optional(),
  shippingDate: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional(),
}).refine(value => Object.keys(value).length > 0, { error: 'Select at least one date field' });
export const updateOrderNoteSchema = z.strictObject({
  orderNote: z.string().trim().max(2000),
  expectedOrderNote: z.string().max(2000),
});

export const cancelCustomerOrderSchema = z.strictObject({ cancellationReason: z.string().trim().min(1).max(1000) });
