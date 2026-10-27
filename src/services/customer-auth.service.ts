import argon2 from "argon2";
import createHttpError from "http-errors";
import { Customer } from "../models/customers.model.js";
import type { ICustomer } from "../types/customers.type.js";
import type { RegisterCustomerInput } from "../types/auth.type.js";
import type { CustomerProfileInput, ShippingAddressInput } from "../validations/customer-account.validation.js";
import { verifyPassword } from "../utils/password.js";
import { generateTokenPair, hashToken, verifyRefreshToken } from "../utils/token.js";
import { sessionRevocationUpdate } from "../utils/session.js";

type CustomerRecord = ICustomer & { _id: { toString(): string } };
export function publicCustomer(customer: CustomerRecord) {
  return { id: customer._id.toString(), accountType: "customer" as const,
    email: customer.email, firstName: customer.firstName, lastName: customer.lastName,
    birthDate: customer.birthDate ?? "", gender: customer.gender ?? "", shippingAddress: customer.shippingAddress,
    phone: customer.phone ?? "", address: customer.address, personalEmail: customer.personalEmail ?? "",
    location: customer.location ?? "", bio: customer.bio ?? "", avatar: customer.avatar ?? "", mustChangePassword: customer.mustChangePassword === true };
}
const subject = (customer: CustomerRecord) => ({ id: customer._id.toString(), tokenVersion: customer.tokenVersion ?? 0, accountType: "customer" as const });

export async function registerCustomer(input: RegisterCustomerInput) {
  if (await Customer.exists({ email: input.email })) throw createHttpError(409, "Email already exists");
  try {
    const customer = await Customer.create({ ...input, password: await argon2.hash(input.password),
      isActive: true, accountEnabled: true, tokenVersion: 0, refreshToken: null });
    return publicCustomer(customer);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) throw createHttpError(409, "Email already exists");
    throw error;
  }
}
export async function loginCustomer(email: string, password: string) {
  const customer = await Customer.findOne({ email, accountEnabled: true }).select("+password +tokenVersion");
  if (!customer || !customer.isActive || !customer.password) throw createHttpError(401, "Invalid email or password");
  const verified = await verifyPassword(customer.password, password);
  if (!verified.valid) throw createHttpError(401, "Invalid email or password");
  const tokens = generateTokenPair(subject(customer));
  const updated = await Customer.findOneAndUpdate({ _id: customer._id, password: customer.password, isActive: true, accountEnabled: true,
    $or: [{ tokenVersion: customer.tokenVersion ?? 0 }, { tokenVersion: { $exists: false } }] },
  { $set: { refreshToken: hashToken(tokens.refreshToken), ...(verified.needsUpgrade ? { password: await argon2.hash(password) } : {}) } });
  if (!updated) throw createHttpError(401, "Account changed; please sign in again");
  return { user: publicCustomer(customer), ...tokens };
}
export async function refreshCustomer(token: string) {
  const decoded = verifyRefreshToken(token);
  if (decoded.accountType !== "customer") throw createHttpError(401, "Customer session required");
  const customer = await Customer.findById(decoded.userId).select("+refreshToken +tokenVersion");
  if (!customer || !customer.isActive || !customer.accountEnabled || customer.tokenVersion !== decoded.version || customer.refreshToken !== hashToken(token)) throw createHttpError(401, "Invalid customer session");
  const tokens = generateTokenPair(subject(customer));
  const updated = await Customer.findOneAndUpdate({ _id: customer._id, isActive: true, accountEnabled: true, tokenVersion: decoded.version, refreshToken: hashToken(token) }, { $set: { refreshToken: hashToken(tokens.refreshToken) } });
  if (!updated) throw createHttpError(401, "Refresh token already used");
  return tokens;
}
export async function logoutCustomer(id: string) {
  await Customer.findByIdAndUpdate(id, sessionRevocationUpdate());
}
export async function changeCustomerPassword(id: string, input: { currentPassword: string; newPassword: string }) {
  const customer = await Customer.findById(id).select("+password +tokenVersion");
  if (!customer?.password || !customer.isActive || !customer.accountEnabled) throw createHttpError(401, "Customer session required");
  if (!(await verifyPassword(customer.password, input.currentPassword)).valid) throw createHttpError(400, "Current password is incorrect");
  const revocation = sessionRevocationUpdate();
  const updated = await Customer.findOneAndUpdate({ _id: id, password: customer.password, tokenVersion: customer.tokenVersion ?? 0, isActive: true, accountEnabled: true },
    { $set: { ...revocation.$set, password: await argon2.hash(input.newPassword), mustChangePassword: false }, $inc: revocation.$inc });
  if (!updated) throw createHttpError(409, "Account changed; please sign in again");
}
export async function updateCustomerProfile(id: string, version: number, input: CustomerProfileInput | { shippingAddress: ShippingAddressInput }) {
  const customer = await Customer.findOneAndUpdate({ _id: id, isActive: true, accountEnabled: true, tokenVersion: version }, { $set: input }, { returnDocument: "after", runValidators: true });
  if (!customer) throw createHttpError(401, "Customer session required");
  return publicCustomer(customer);
}
