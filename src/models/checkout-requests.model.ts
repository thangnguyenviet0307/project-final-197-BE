import { Schema, model, Types } from "mongoose";

export interface CheckoutReceipt {
  customerId: Types.ObjectId | null;
  requestId: string;
  payloadHash: string;
  reservationExpiredAt?: Date;
  result: { _id: Types.ObjectId; orderCode: string; totalAmount: number; orderStatus: number };
}
// Retain the receipt even if an admin deletes the rejected order. Replaying a
// confirmed request must never reserve stock or create another order.
const schema = new Schema<CheckoutReceipt>({
  customerId: { type: Schema.Types.ObjectId, default: null },
  requestId: { type: String, required: true },
  payloadHash: { type: String, required: true, select: false },
  reservationExpiredAt: { type: Date },
  result: { type: new Schema({
    _id: { type: Schema.Types.ObjectId, required: true },
    orderCode: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    orderStatus: { type: Number, required: true },
  }, { _id: false }), required: true },
}, { timestamps: true, collection: "checkout_requests" });
schema.index({ customerId: 1, requestId: 1 }, { unique: true });
export const CheckoutRequest = model<CheckoutReceipt>("CheckoutRequest", schema);
