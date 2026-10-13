
import mongoose, { Schema, model } from "mongoose";
import type { ICustomer } from "../types/customers.js";

const customerSchema = new Schema<ICustomer>(
  {
    customer_id: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
    },

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

    zip_code: {
      type: String,
      maxlength: 5,
      default: null,
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
  mongoose.models["Customer"] ||
  model<ICustomer>("Customer", customerSchema);
