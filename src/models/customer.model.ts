import { Schema, model } from 'mongoose';
import type { ICustomer } from '../types/customer.type.js';

const customerSchema = new Schema<ICustomer>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, required: true, trim: true },
    address: {
      street: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
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