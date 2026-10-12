
import { model, Schema } from "mongoose";
import type {
  ICustomer,
  ICustomerAddress,
} from "../types/customers.js";

const addressSchema = new Schema<ICustomerAddress>(
  {
    recipientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    province: { type: String, required: true, trim: true },
    ward: { type: String, required: true, trim: true },
    detail: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const customerSchema = new Schema<ICustomer>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
},

    phone: {
      type: String,
      trim: true,
    },

    avatarUrl: {
      type: String,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },

    dateOfBirth: {
      type: Date,
    },

    addresses: {
      type: [addressSchema],
      default: [],
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "customers",
  },
);

customerSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $type: "objectId" },
    },
  },
);

export const CustomerModel = model<ICustomer>(
  "Customer",
  customerSchema,
);
