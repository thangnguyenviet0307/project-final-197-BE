import argon2 from "argon2";
import createHttpError from "http-errors";
import { User } from "../models/user.model.js";
import { escapeRegex } from "../utils/search.js";
import { buildPagination } from "../utils/pagination.js";
import type { CreateUserInput, UpdateUserInput, GetUsersQuery } from "../validations/user.validation.js";

export const UserService = {
  async getAllUsers({ page, limit, search }: GetUsersQuery) {
    const filter = search ? { $or: ["firstName", "lastName", "email"].map((field) => ({
      [field]: new RegExp(escapeRegex(search), "i"),
    })) } : {};
    const [data, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    return { data, pagination: buildPagination(page, limit, total) };
  },
  async getUserById(id: string) {
    const user = await User.findById(id);
    if (!user) throw createHttpError(404, "User not found");
    return user;
  },
  async createUser(input: CreateUserInput) {
    if (await User.exists({ email: input.email })) throw createHttpError(409, "Email already exists");
    return User.create({ ...input, password: await argon2.hash(input.password) });
  },
  async updateUser(id: string, input: UpdateUserInput) {
    const { password, ...fields } = input;
    const update = {
      $set: { ...fields, ...(password ? { password: await argon2.hash(password) } : {}),
        ...(password || fields.active === false ? { refreshToken: null } : {}) },
      ...(password || fields.active === false ? { $inc: { tokenVersion: 1 } } : {}),
    };
    const user = await User.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!user) throw createHttpError(404, "User not found");
    return user;
  },
  async deleteUser(id: string) {
    const user = await User.findByIdAndDelete(id);
    if (!user) throw createHttpError(404, "User not found");
  },
};
