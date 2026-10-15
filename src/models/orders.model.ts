import { Schema, model } from 'mongoose';
import { OrderStatus, type IOrder, type IOrderItem } from '../types/orders.type.js';

// order_items: sub schema dạng embedding, mỗi item có _id riêng thay cho item_id
const orderItemSchema = new Schema<IOrderItem>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, default: 0 },
  price: { type: Number, required: true, default: 0 },
  discount: { type: Number, default: 0 },
});

const orderSchema = new Schema<IOrder>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    orderStatus: { type: Number, required: true, default: OrderStatus.Pending },
    orderDate: { type: Date, required: true, default: Date.now },
    requireDate: { type: Date },
    shippingDate: { type: Date },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    orderNote: { type: String, trim: true },
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    paymentType: { type: Number, required: true },
    orderItems: { type: [orderItemSchema], default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

orderSchema.index({ customerId: 1, orderDate: -1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ staffId: 1 });

// Tổng tiền đơn hàng = Σ quantity * price * (1 - discount / 100)
orderSchema.virtual('totalAmount').get(function () {
  return this.orderItems.reduce(
    (sum, item) => sum + item.quantity * item.price * (1 - item.discount / 100),
    0,
  );
});

export const Order = model<IOrder>('Order', orderSchema);