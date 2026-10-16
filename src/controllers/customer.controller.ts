import type { Request, Response, RequestHandler } from 'express';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '../services/customer.service.js';
import { asyncHandler } from '../utils/async-handler.util.js';
import { ApiError } from '../middlewares/error.middleware.js';

interface GetCustomersQuery {
  page?: string;
  limit?: string;
  search?: string;
  isActive?: string;
}

const getCustomersHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search, isActive } = req.query as GetCustomersQuery;

  const result = await getCustomers({
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 10,
    search,
    isActive: isActive !== undefined ? isActive === 'true' : undefined,
  });

  res.status(200).json({
    success: true,
    message: 'Lấy danh sách khách hàng thành công',
    data: result.data,
    pagination: result.pagination,
  });
});

const getCustomerByIdHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const customer = await getCustomerById(id as string);

  res.status(200).json({
    success: true,
    message: 'Lấy chi tiết khách hàng thành công',
    data: customer,
  });
});

const createCustomerHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await createCustomer(req.body);

  res.status(201).json({
    success: true,
    message: 'Tạo khách hàng thành công',
    data: customer,
  });
});

const updateCustomerHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const customer = await updateCustomer(id as string, req.body);

  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');

  res.status(200).json({
    success: true,
    message: 'Cập nhật khách hàng thành công',
    data: customer,
  });
});

const deleteCustomerHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  await deleteCustomer(id as string);

  res.status(200).json({
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