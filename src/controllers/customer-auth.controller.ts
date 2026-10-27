import createHttpError from "http-errors";
import type { Request, RequestHandler } from "express";
import type { CustomerRequest } from "../middlewares/customer-auth.middleware.js";
import { asyncHandler } from "../utils/async-handler.util.js";
import { authResponse, clearRefreshCookie } from "../utils/auth-cookie.js";
import { sendResponse } from "../helpers/response.helper.js";
import { registerCustomer, loginCustomer, refreshCustomer, logoutCustomer, publicCustomer, changeCustomerPassword, updateCustomerProfile } from "../services/customer-auth.service.js";

import { listCustomerOrders } from "../services/customer-orders.service.js";
import { customerOrdersQuerySchema } from "../validations/customer-account.validation.js";
function actor(req: Request) {
  const customer = (req as CustomerRequest).customer;
  if (!customer) throw createHttpError(401, "Customer session required");
  return customer;
}
export const customerAuthController: Record<"register" | "login" | "refresh" | "me" | "profile" | "logout" | "password" | "shippingAddress" | "orders", RequestHandler> = {
  register: asyncHandler(async (req, res) => { sendResponse(res, 201, { data: await registerCustomer(req.body), message: "Account created. Please sign in." }); }),
  login: asyncHandler(async (req, res) => { sendResponse(res, 200, { data: authResponse(req, res, await loginCustomer(req.body.email, req.body.password)) }); }),
  refresh: asyncHandler(async (req, res) => { sendResponse(res, 200, { data: authResponse(req, res, await refreshCustomer(req.body.refreshToken)) }); }),
  me: asyncHandler(async (req, res) => { sendResponse(res, 200, { data: publicCustomer(actor(req)) }); }),
  profile: asyncHandler(async (req, res) => { const customer = actor(req); sendResponse(res, 200, { data: await updateCustomerProfile(customer._id.toString(), customer.tokenVersion ?? 0, req.body) }); }),
  shippingAddress: asyncHandler(async (req, res) => {
    const customer = actor(req);
    sendResponse(res, 200, { data: await updateCustomerProfile(customer._id.toString(), customer.tokenVersion ?? 0, { shippingAddress: req.body }) });
  }),
  orders: asyncHandler(async (req, res) => {
    const query = customerOrdersQuerySchema.parse(req.query);
    sendResponse(res, 200, await listCustomerOrders(actor(req)._id.toString(), query.page, query.limit));
  }),
  logout: asyncHandler(async (req, res) => { await logoutCustomer(actor(req)._id.toString()); clearRefreshCookie(res, "storefront"); sendResponse(res, 200, { data: null }); }),
  password: asyncHandler(async (req, res) => { await changeCustomerPassword(actor(req)._id.toString(), req.body); clearRefreshCookie(res, "storefront"); sendResponse(res, 200, { data: null }); }),
};
