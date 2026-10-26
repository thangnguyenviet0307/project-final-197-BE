import { OPEN_ORDER_STATUSES } from "../types/orders.type.js";
import argon2 from "argon2";
import createHttpError from "http-errors";
import { User } from "../models/users.model.js";
import { accentInsensitiveRegex } from "../utils/search.js";
import { buildPagination } from "../utils/pagination.js";
import type { CreateUserInput, UpdateUserInput, GetUsersQuery } from "../types/users.type.js";
import type { ClientSession } from "mongoose";
import { Order } from "../models/orders.model.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { sessionRevocationUpdate } from "../utils/session.js";

async function protectLastAdmin(id: string, session: ClientSession) {
  const user = await User.findById(id).session(session);
  if (!user) throw createHttpError(404, "User not found");
  if (user.role === "admin" && (user.active === true || user.active === undefined)) {
    const other = await User.exists({ _id: { $ne: id }, role: "admin",
      $or: [{ active: true }, { active: { $exists: false } }] }).session(session);
    if (!other) throw createHttpError(409, "Cannot remove the last active administrator");
  }
}

export const UserService = {
  async getAllUsers({ page, limit, search }: GetUsersQuery) {
    const searchTerms = search?.trim().split(/\s+/).filter(Boolean) ?? [];
    const filter = { role: { $in: ["admin", "staff"] as const }, ...(searchTerms.length
      ? {
          $and: searchTerms.map((term) => ({
            $or: ["firstName", "lastName", "email"].map((field) => ({
              [field]: accentInsensitiveRegex(term),
            })),
          })),
        }
      : {}) };
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
    return User.create({ ...input, mustChangePassword: true, password: await argon2.hash(input.password) });
  },
  async updateUser(id: string, input: UpdateUserInput) {
    const { password, ...fields } = input;
    const shouldRevokeSessions = Boolean(password || fields.active === false || fields.role);
    const revocation = shouldRevokeSessions ? sessionRevocationUpdate() : undefined;
    const update = {
      $set: { ...fields, ...(password ? { password: await argon2.hash(password), mustChangePassword: true } : {}),
        ...revocation?.$set },
      ...(revocation ? { $inc: revocation.$inc } : {}),
    };
    const saveUser = async (session?: ClientSession) => {
      const user = await User.findByIdAndUpdate(id, update, {
        new: true, runValidators: true, ...(session ? { session } : {}),
      });
      if (!user) throw createHttpError(404, "User not found");
      return user;
    };
    if (fields.active !== undefined || fields.role !== undefined) {
      return withRelationsTransaction(async (session) => {
        if (fields.active === false || fields.role === "staff") await protectLastAdmin(id, session);
        if (fields.active === false && await Order.exists({ userId: id, orderStatus: { $in: OPEN_ORDER_STATUSES } }).session(session)) {
          throw createHttpError(409, "Reassign open orders before disabling this user");
        }
        return saveUser(session);
      });
    }
    return saveUser();
  },
  async deleteUser(id: string) {
    return withRelationsTransaction(async (session) => {
      await protectLastAdmin(id, session);
      if (await Order.exists({ userId: id }).session(session)) throw createHttpError(409, "Cannot delete a user referenced by orders");
      await User.findByIdAndDelete(id, { session });
    });
  },
};
