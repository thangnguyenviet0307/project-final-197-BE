import { Schema, model } from 'mongoose';
import type { ICustomer } from '../types/customers.type.js';

const customerSchema = new Schema<ICustomer>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: "User", unique: true, sparse: true },
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, default: "", trim: true },
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

export const Customer = model<ICustomer>('Customer', customerSchema);