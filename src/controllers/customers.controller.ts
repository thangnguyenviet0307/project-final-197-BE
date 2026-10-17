import { sendResponse } from "../helpers/response.helper.js";
import type { GetCustomersQuery } from "../types/customers.type.js";
import type { Request, Response, RequestHandler } from 'express';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '../services/customers.service.js';
import { asyncHandler } from '../utils/async-handler.util.js';
import { ApiError } from '../middlewares/error.middleware.js';

const getCustomersHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await getCustomers(req.query as unknown as GetCustomersQuery);
  sendResponse(res, 200, { success: true, message: 'Customers retrieved successfully', ...result });
});

const getCustomerByIdHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const customer = await getCustomerById(id as string);

  sendResponse(res, 200, {
    success: true,
    message: 'Lấy chi tiết khách hàng thành công',
    data: customer,
  });
});

const createCustomerHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await createCustomer(req.body);

  sendResponse(res, 201, {
    success: true,
    message: 'Tạo khách hàng thành công',
    data: customer,
  });
});

const updateCustomerHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const customer = await updateCustomer(id as string, req.body);

  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');

  sendResponse(res, 200, {
    success: true,
    message: 'Cập nhật khách hàng thành công',
    data: customer,
  });
});

const deleteCustomerHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  await deleteCustomer(id as string);

  sendResponse(res, 200, {
    success: true,
    message: 'Xóa khách hàng thành công',
    data: null,
  });
});

export const customerController: Record<string, RequestHandler> = {
  getCustomers: getCustomersHandler,
  getCustomerById: getCustomerByIdHandler,
  createCustomer: createCustomerHandler,
  updateCustomer: updateCustomerHandler,
  deleteCustomer: deleteCustomerHandler,
};
