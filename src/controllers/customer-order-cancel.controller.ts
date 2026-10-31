import type { RequestHandler } from "express";
import createHttpError from "http-errors";
import type { CustomerRequest } from "../middlewares/customer-auth.middleware.js";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import { cancelCustomerOrder } from "../services/customer-orders.service.js";
import { idParamSchema } from "../validations/common.validation.js";
import { cancelCustomerOrderSchema } from "../validations/customer-order-cancel.validation.js";

export const cancelCustomerOrderController: RequestHandler = asyncHandler(
  async (req, res) => {
    const customer = (req as CustomerRequest).customer;
    if (!customer) throw createHttpError(401, "Customer session required");
    const { id } = idParamSchema.parse(req.params);
    const { cancellationReason } = cancelCustomerOrderSchema.parse(req.body);
    sendResponse(res, 200, {
      data: await cancelCustomerOrder(
        customer._id.toString(),
        customer.tokenVersion ?? 0,
        id,
        cancellationReason,
      ),
    });
  },
);
