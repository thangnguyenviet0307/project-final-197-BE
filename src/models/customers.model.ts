import { Schema, model } from 'mongoose';
import type { ICustomer } from '../types/customers.type.js';

const customerSchema = new Schema<ICustomer>(
  {
    birthDate: { type: String, default: "" },
    gender: { type: String, enum: ["", "male", "female", "other"], default: "" },
    shippingAddress: { type: new Schema({
      recipientName: { type: String, trim: true, maxlength: 100 },
      email: { type: String, trim: true, lowercase: true },
      province: { type: String, trim: true, maxlength: 100 },
      district: { type: String, trim: true, maxlength: 100 },
      ward: { type: String, trim: true, maxlength: 100 },
      street: { type: String, trim: true, maxlength: 255 },
      deliveryTime: { type: String, trim: true, maxlength: 255, default: "" },
    }, { _id: false }), default: undefined },
    mustChangePassword: { type: Boolean, default: false },
    password: { type: String, select: false },
    accountEnabled: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0, select: false },
    refreshToken: { type: String, default: null, select: false },
    personalEmail: { type: String, trim: true, lowercase: true, default: "" },
    location: { type: String, trim: true, maxlength: 255, default: "" },
    bio: { type: String, trim: true, maxlength: 1000, default: "" },
    avatar: { type: String, default: "" },
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, default: "", trim: true, maxlength: 30 },
    address: {
      street: { type: String, default: "", trim: true },
      city: { type: String, default: "", trim: true },
      state: { type: String, default: "", trim: true },
    },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'customers',
  },
);

customerSchema.index({ phone: 1 });
customerSchema.index({ isActive: 1 });

const stripSecrets = (_doc: unknown, value: unknown) => {
  const result = value as Record<string, unknown>;
  for (const key of ["password", "refreshToken", "tokenVersion", "accountId"]) delete result[key];
  return result;
};
customerSchema.set("toJSON", { transform: stripSecrets });
customerSchema.set("toObject", { transform: stripSecrets });
export const Customer = model<ICustomer>('Customer', customerSchema);
