import { toAuthUser, toPublicUser } from "../utils/user-mapper.js";
import mongoose from "mongoose";
import { timingSafeEqual } from "node:crypto";
import { SystemLock } from "../models/system-locks.model.js";
import argon2 from "argon2";
import createHttpError from "http-errors";
import { Customer } from "../models/customers.model.js";
import { User } from "../models/users.model.js";
import {
  generateTokenPair,
  verifyRefreshToken,
  hashToken,
} from "../utils/token.js";
import type { CreateUserInput } from "../types/users.type.js";
import { verifyPassword } from "../utils/password.js";
import { sessionRevocationUpdate } from "../utils/session.js";

import type { RegisterCustomerInput } from "../types/auth.type.js";

export async function registerCustomer(input: RegisterCustomerInput) {
  if (await User.exists({ email: input.email })) {
    throw createHttpError(409, "Email already exists");
  }
  if (await Customer.exists({ email: input.email })) {
    throw createHttpError(409, "Email already exists in customer contacts. Please contact the store for assistance.");
  }
  const password = await argon2.hash(input.password);
  return mongoose.connection.transaction(async session => {
    const [user] = await User.create([{
      email: input.email, firstName: input.firstName, lastName: input.lastName,
      password, role: "customer", active: true, mustChangePassword: false,
      tokenVersion: 0, refreshToken: null,
    }], { session });
    if (!user) throw createHttpError(500, "Cannot create customer account");
    await Customer.create([{
      accountId: user._id, email: input.email, firstName: input.firstName,
      lastName: input.lastName, isActive: true,
    }], { session });
    return toPublicUser(toAuthUser(user));
  });
}

export async function login(email: string, password: string, area?: "storefront" | "admin") {
  const user = await User.findOne({ email }).select("+password +tokenVersion");
  // Missing active belongs to legacy accounts; explicit false/null remains disabled.
  if (!user || (user.active !== undefined && user.active !== true)) {
    throw createHttpError(401, "Email hoặc mật khẩu không chính xác");
  }

  const verification = await verifyPassword(user.password, password);
  if (!verification.valid) {
    throw createHttpError(401, "Email hoặc mật khẩu không chính xác");
  }

  if (area && (area === "storefront" ? user.role !== "customer" : user.role === "customer")) {
    throw createHttpError(401, "Tài khoản không tồn tại !");
  }
  const authUser = toAuthUser(user, true);

  const { accessToken, refreshToken } = generateTokenPair(authUser);
  const upgradedPassword = verification.needsUpgrade ? await argon2.hash(password) : undefined;

  const updated = await User.findOneAndUpdate(
    { _id: user._id, password: user.password,
      $and: [
        { $or: [{ active: true }, { active: { $exists: false } }] },
        { $or: [{ tokenVersion: user.tokenVersion ?? 0 }, { tokenVersion: { $exists: false } }] },
      ] },
    { $set: {
      refreshToken: hashToken(refreshToken), tokenVersion: user.tokenVersion ?? 0, active: true,
      ...(upgradedPassword ? { password: upgradedPassword } : {}),
    } },
    { runValidators: true },
  );
  if (!updated) throw createHttpError(401, "Account changed; please sign in again");

  return {
    user: toPublicUser(authUser),
    accessToken,
    refreshToken,
  };
}

export async function bootstrapAdmin(input: Omit<CreateUserInput, "role">, suppliedSecret?: string) {
  const configured = process.env["BOOTSTRAP_SECRET"];
  if (!configured || !suppliedSecret || !timingSafeEqual(
    Buffer.from(hashToken(configured)), Buffer.from(hashToken(suppliedSecret)),
  )) throw createHttpError(403, "Bootstrap is disabled or secret is invalid");
  const password = await argon2.hash(input.password);
  return mongoose.connection.transaction(async (session) => {
    if (await User.countDocuments().session(session)) throw createHttpError(403, "System already initialized");
    await SystemLock.create([{ _id: "admin-bootstrap" }], { session });
    const user = new User({ ...input, password, role: "admin", active: true, tokenVersion: 0 });
    const authUser = toAuthUser(user, true);
    const { accessToken, refreshToken } = generateTokenPair(authUser);
    user.refreshToken = hashToken(refreshToken);
    await user.save({ session });
    return { user: toPublicUser(authUser), accessToken, refreshToken };
  });
}

export async function logout(userId: string) {
  await User.findByIdAndUpdate(userId, sessionRevocationUpdate());
}

export async function refresh(refreshToken: string, area?: "storefront" | "admin") {
  const decoded = verifyRefreshToken(refreshToken);
  const user = await User.findById(decoded.userId).select("+refreshToken +tokenVersion");
  if (!user || !user.active || user.refreshToken !== hashToken(refreshToken) || (user.tokenVersion ?? 0) !== decoded.version) {
    throw createHttpError(401, "Refresh token không hợp lệ");
  }
  if (area && (area === "storefront" ? user.role !== "customer" : user.role === "customer")) {
    throw createHttpError(401, "Tài khoản không tồn tại !");
  }
  const authUser = toAuthUser(user);
  const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokenPair(authUser);
  const rotated = await User.findOneAndUpdate(
    { _id: user._id, refreshToken: hashToken(refreshToken), tokenVersion: decoded.version, active: true },
    { $set: { refreshToken: hashToken(newRefreshToken) } },
  );
  if (!rotated) throw createHttpError(401, "Refresh token already used");

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}


export async function changePassword(userId: string, input: { currentPassword: string; newPassword: string }) {
  const user = await User.findById(userId).select("+password +tokenVersion");
  if (!user || !user.active) throw createHttpError(401, "Session is no longer valid");
  const verification = await verifyPassword(user.password, input.currentPassword);
  if (!verification.valid) throw createHttpError(400, "Current password is incorrect");
  const revocation = sessionRevocationUpdate();
  const updated = await User.findOneAndUpdate(
    { _id: user._id, password: user.password, active: true,
      $or: [{ tokenVersion: user.tokenVersion ?? 0 }, { tokenVersion: { $exists: false } }] },
    { $set: { ...revocation.$set, password: await argon2.hash(input.newPassword), mustChangePassword: false },
      $inc: revocation.$inc },
    { runValidators: true },
  );
  if (!updated) throw createHttpError(409, "Account changed; please sign in again");
}
