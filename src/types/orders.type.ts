import { Types } from 'mongoose';

export enum OrderStatus {
  Pending = 1,
  Processing = 2,
  Rejected = 3,
  Completed = 4,
}

export enum PaymentType {
  COD = 1
}

// order_items: sub schema (embedding) của Order
export interface IOrderItem {
  productId: Types.ObjectId;
  quantity: number;
  price: number; // giá tại thời điểm đặt hàng
  discount: number; // % giảm giá tại thời điểm đặt hàng, 0 - 70
}

export interface IOrder {
  customerId: Types.ObjectId;
  orderStatus: OrderStatus;
  orderDate: Date;
  requireDate?: Date;
  shippingDate?: Date;
  staffId?: Types.ObjectId;
  orderNote?: string;
  street: string;
  city: string;
  state: string;
  paymentType: PaymentType;
  orderItems: IOrderItem[];
}