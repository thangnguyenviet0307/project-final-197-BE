import createHttpError from "http-errors";
import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import type { CustomerRequest } from "../middlewares/customer-auth.middleware.js";
import { checkout } from "../services/checkout.service.js";
import { getCheckoutLocations } from "../services/checkout-locations.service.js";
import { checkoutSchema } from "../validations/checkout.validation.js";

export const createCheckout: RequestHandler = asyncHandler(async (req, res) => {
  const customer = (req as CustomerRequest).customer;
  if (!customer) throw createHttpError(401, "Customer session required");
  sendResponse(res, 201, { data: await checkout(customer._id.toString(), customer.tokenVersion ?? 0, checkoutSchema.parse(req.body)) });
});
export const checkoutLocations: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await getCheckoutLocations() });
});

export const createGuestCheckout: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 201, { data: await checkout(null, 0, checkoutSchema.parse(req.body)) });
});
