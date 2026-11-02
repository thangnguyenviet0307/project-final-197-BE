import { Schema, model } from 'mongoose';
import type { IOrder, IOrderItem } from '../types/orders.type.js';
import { OrderStatus, PaymentType } from '../types/orders.type.js';
import { generateOrderCode } from '../utils/order-code.js';
import { calculateOrderTotal } from '../utils/order-total.js';

// order_items: sub schema dạng embedding, mỗi item có _id riêng thay cho item_id
const orderItemSchema = new Schema<IOrderItem>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId },
  sku: { type: String },
  productName: { type: String },
  variantName: { type: String },
  selectedOptions: { type: Schema.Types.Mixed },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  price: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0, max: 70 },
});

const orderSchema = new Schema<IOrder>(
  {
    guestCheckout: { type: Boolean },
    reservationExpiresAt: { type: Date },
    reservationExpiredAt: { type: Date },
    reservationRetryAt: { type: Date },
    checkoutRequestId: { type: String },
    cancelledByCustomer: { type: Boolean },
    checkoutFingerprint: { type: String, select: false },
    recipientName: { type: String, trim: true, maxlength: 100 },
    recipientPhone: { type: String, trim: true, maxlength: 20 },
    deliveryAddress: { type: new Schema({ province: String, district: String, ward: String, provinceCode: Number, districtCode: Number, wardCode: Number }, { _id: false }) },
    orderCode: { type: String, immutable: true, match: /^ORD-[A-HJ-NP-Z2-9]{6}$/ },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: function () { return !this.guestCheckout; } },
    customerSnapshot: { type: new Schema({ firstName: String, lastName: String, email: String, phone: String }, { _id: false }) },
    orderStatus: { type: Number, required: true, default: OrderStatus.Pending,
      enum: [OrderStatus.Pending, OrderStatus.Processing, OrderStatus.Rejected, OrderStatus.Completed] },
    orderDate: { type: Date, required: true, default: Date.now },
    requireDate: { type: Date },
    plannedShippingDate: { type: Date },
    shippingDate: { type: Date },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: { type: String, trim: true, maxlength: 1000 },
    orderNote: { type: String, trim: true },
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    paymentType: { type: Number, required: true, enum: [PaymentType.COD] },
    orderItems: { type: [orderItemSchema], required: true,
      validate: { validator: (items: IOrderItem[]) => items.length > 0, message: 'Order must contain at least one item' } },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    collection: 'orders',
  },
);

orderSchema.index({ customerId: 1, orderDate: -1 });
orderSchema.index({ customerId: 1, checkoutRequestId: 1 }, { unique: true, partialFilterExpression: { checkoutRequestId: { $type: 'string' } } });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ guestCheckout: 1, orderStatus: 1, reservationExpiresAt: 1 });
orderSchema.index({ orderStatus: 1, "orderItems.productId": 1 });
orderSchema.index({ userId: 1 });
orderSchema.index({ orderCode: 1 }, { unique: true, partialFilterExpression: { orderCode: { $type: 'string' } } });
orderSchema.pre('validate', function () {
  if (this.guestCheckout && this.customerId) this.invalidate('customerId', 'Guest orders cannot belong to an account');
  if (this.isNew && !this.orderCode) this.orderCode = generateOrderCode();
});

// Tổng tiền đơn hàng = Σ quantity * price * (1 - discount / 100)
orderSchema.virtual('totalAmount').get(function (this: IOrder) {
  return calculateOrderTotal(this.orderItems);
});

export const Order = model<IOrder>('Order', orderSchema);
