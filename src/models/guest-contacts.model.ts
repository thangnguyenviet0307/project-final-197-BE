import { Schema, model, type Types } from 'mongoose';
import type { ICustomer } from '../types/customers.type.js';

export interface GuestContact {
  _id: Types.ObjectId;
  email: string;
  phone: string;
  phoneKey: string;
  recipientName: string;
  shippingAddress: NonNullable<ICustomer['shippingAddress']>;
  address: ICustomer['address'];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// CRM contact data only. Never credentials, accountEnabled or authentication IDs.
const schema = new Schema<GuestContact>(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    phoneKey: { type: String, required: true },
    recipientName: { type: String, required: true, trim: true, maxlength: 100 },
    shippingAddress: { type: Schema.Types.Mixed, required: true },
    address: { type: Schema.Types.Mixed, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false, collection: 'guest_contacts' }
);
schema.index({ email: 1 }, { unique: true });
schema.index({ phoneKey: 1 }, { unique: true });
export const GuestContacts = model<GuestContact>('GuestContact', schema);
