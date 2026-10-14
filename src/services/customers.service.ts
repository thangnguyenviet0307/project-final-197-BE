import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { CustomerModel } from "../models/customers.model.js";
import { ApiError } from "../middlewares/error.middleware.js";

import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "../validations/customers.validation.js";

const checkId = (id: string) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid customer ID");
  }
};

export class CustomerService {
  static async getAll() {
    return CustomerModel.find()
      .select("-password")
      .sort({ createdAt: -1 });
  }

  static async getById(id: string) {
    checkId(id);

    const customer = await CustomerModel.findById(id)
      .select("-password");

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    return customer;
  }

  static async create(data: CreateCustomerInput) {
  const exists = await CustomerModel.findOne({
    $or: [
      { email: data.email.toLowerCase() },
      { phone: data.phone },
    ],
  });

  if (exists) {
    throw new ApiError(
      409,
      "Customer email or phone already exists"
    );
  }

  const { password, birthday, ...customerData } = data;

  const hashedPassword = password
    ? await bcrypt.hash(password, 10)
    : null;

  const customer = new CustomerModel({
    ...customerData,
    ...(birthday !== undefined ? { birthday } : {}),
    password: hashedPassword,
  });

  await customer.save();

  const result = customer.toObject();
  delete result.password;

  return result;
}

  static async update(
    id: string,
    data: UpdateCustomerInput
  ) {
    checkId(id);

    const customer = await CustomerModel.findById(id);

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    if (data.email || data.phone) {
      const conditions = [];

      if (data.email) {
        conditions.push({
          email: data.email.toLowerCase(),
        });
      }

      if (data.phone) {
        conditions.push({ phone: data.phone });
      }

      const exists = await CustomerModel.findOne({
        _id: { $ne: id },
        $or: conditions,
      });

      if (exists) {
        throw new ApiError(
          409,
          "Customer email or phone already exists"
        );
      }
    }

    const { password, ...updateData } = data;

    Object.assign(customer, updateData);

    if (password !== undefined) {
      customer.password = password
        ? await bcrypt.hash(password, 10)
        : null;
    }

    await customer.save();

    const result = customer.toObject();
    delete result.password;

    return result;
  }

  static async delete(id: string) {
    checkId(id);

    const customer =
      await CustomerModel.findByIdAndDelete(id);

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    return { _id: customer._id };
  }
}