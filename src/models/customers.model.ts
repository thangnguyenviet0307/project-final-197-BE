
import { Schema, model } from "mongoose";
import type { ICustomer } from "../types/customers.js";

const customerSchema = new Schema<ICustomer>(
  {
    first_name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    last_name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      unique: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 150,
      unique: true,
    },

    birthday: {
      type: Date,
      default: null,
    },

    street: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },

    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    state: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    password: {
      type: String,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    collection: "customers",
  }
);

export const CustomerModel =
  model<ICustomer>("Customer", customerSchema);
