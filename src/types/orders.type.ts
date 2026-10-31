import type { IPaginationQuery } from "./common.types.js";
import { Types } from 'mongoose';

export enum OrderStatus {
  Pending = 1,
  Processing = 2,
  Rejected = 3,
  Completed = 4,
}

export enum PaymentType {
  COD = 1,
}

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [OrderStatus.Pending, OrderStatus.Processing];

// order_items: sub schema (embedding) của Order
export interface IOrderItem {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  sku?: string;
  productName?: string;
  variantName?: string | null;
  selectedOptions?: Record<string, string | number | boolean | null>;
  quantity: number;
  price: number; // giá tại thời điểm đặt hàng
  discount: number; // % giảm giá tại thời điểm đặt hàng, 0 - 70
}

export interface IOrder {
  guestCheckout?: boolean;
  reservationExpiresAt?: Date;
  reservationExpiredAt?: Date;
  reservationRetryAt?: Date;
  cancelledByCustomer?: boolean;
  checkoutRequestId?: string;
  checkoutFingerprint?: string;
  recipientName?: string;
  recipientPhone?: string;
  deliveryAddress?: { province: string; district: string; ward: string; provinceCode: number; districtCode: number; wardCode: number };
  plannedShippingDate?: Date;
  orderCode?: string;
  customerId: Types.ObjectId | null;
  customerSnapshot?: { firstName: string; lastName: string; email: string; phone: string };
  orderStatus: OrderStatus;
  orderDate: Date;
  requireDate?: Date;
  shippingDate?: Date;
  userId?: Types.ObjectId; // User (Admin/Staff) đang phụ trách đơn
  orderNote?: string;
  cancellationReason?: string;
  street: string;
  city: string;
  state: string;
  paymentType: PaymentType;
  orderItems: IOrderItem[];
}

export interface OrderItemInput {
  productId: string;
  variantId?: string | undefined;
  quantity: number;
}
export interface CreateOrderInput {
  customerId: string;
  userId?: string | undefined;
  requireDate?: Date | undefined;
  orderNote?: string | undefined;
  street: string;
  city: string;
  state: string;
  paymentType: number;
  orderItems: OrderItemInput[];
}
export interface UpdateOrderStatusInput {
  cancellationReason?: string | undefined;
  orderStatus: number;
  shippingDate?: Date | undefined;
  userId?: string | undefined;
}
export interface GetOrdersQuery extends IPaginationQuery {
  search?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  orderStatus?: number | undefined;
  customerId?: string | undefined;
  userId?: string | undefined;
}
export interface AssignOrderInput {
  userId: string;
}
