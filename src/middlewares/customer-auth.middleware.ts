import type { Request, RequestHandler } from "express";
import createHttpError from "http-errors";
import { Customer } from "../models/customers.model.js";
import { verifyAccessToken } from "../utils/token.js";
import type { ICustomer } from "../types/customers.type.js";

export interface CustomerRequest extends Request {
  customer?: ICustomer & { _id: { toString(): string } };
}
export const authenticateCustomer: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw createHttpError(401, "Customer session required");
    const token = verifyAccessToken(header.slice(7));
    if (token.accountType !== "customer")
      throw createHttpError(403, "Customer session required");
    const customer = await Customer.findById(token.userId).select(
      "+tokenVersion",
    );
    if (
      !customer ||
      !customer.isActive ||
      !customer.accountEnabled ||
      (customer.tokenVersion ?? 0) !== token.version
    )
      throw createHttpError(401, "Customer session expired");
    if (
      customer.mustChangePassword &&
      !["/me", "/logout", "/change-password"].includes(req.path)
    )
      throw createHttpError(403, "Password change required");
    (req as CustomerRequest).customer = customer;
    next();
  } catch (error) {
    next(error);
  }
};
