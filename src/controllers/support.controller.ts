import type { Request, RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.util.js';
import { sendResponse } from '../helpers/response.helper.js';
import type { CustomerRequest } from '../middlewares/customer-auth.middleware.js';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { supportListSchema } from '../validations/support.validation.js';
import * as service from '../services/support.service.js';

const customer = (req: Request) => (req as CustomerRequest).customer!;
const customerId = (req: Request) => customer(req)._id.toString();
const id = (req: Request) => req.params['id'] as string;
export const publicPolicy: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.getPolicy() });
});
export const adminPolicy: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.getPolicy(true) });
});
export const savePolicy: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.savePolicy(req.body) });
});
export const eligibleOrders: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(
    res,
    200,
    await service.eligibleWarrantyOrders(
      customerId(req),
      supportListSchema.parse(req.query)
    )
  );
});
export const createWarranty: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 201, {
    data: await service.createWarranty(customer(req), req.body),
  });
});
export const customerList: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(
    res,
    200,
    await service.listWarranties(
      supportListSchema.parse(req.query),
      customerId(req)
    )
  );
});
export const adminList: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(
    res,
    200,
    await service.listWarranties(supportListSchema.parse(req.query))
  );
});
export const customerDetail: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: service.warrantyDto(
      await service.getWarranty(id(req), customerId(req)),
      false
    ),
  });
});
export const adminDetail: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: service.warrantyDto(await service.getWarranty(id(req)), true),
  });
});
export const updateWarranty: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await service.updateWarranty(
      id(req),
      (req as AuthenticatedRequest).user!,
      req.body
    ),
  });
});
export const uploadImage: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await service.addWarrantyImage(id(req), customerId(req), req.file),
  });
});
