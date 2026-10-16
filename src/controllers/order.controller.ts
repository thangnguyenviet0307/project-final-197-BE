import type { Request, Response, RequestHandler } from 'express';
import {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  deleteOrder,
} from '../services/order.services.js';
import type { AuthUser } from '../types/auth.type.js';
import { asyncHandler } from '../utils/async-handler.util.js';

interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

interface GetOrdersQuery {
  page?: string;
  limit?: string;
  orderStatus?: string;
  customerId?: string;
  userId?: string;
}

const getOrdersHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const { page, limit, orderStatus, customerId, userId } = req.query as GetOrdersQuery;

  const result = await getOrders(actor, {
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 10,
    orderStatus: orderStatus ? parseInt(orderStatus, 10) : undefined,
    customerId,
    userId,
  });

  res.status(200).json({
    success: true,
    message: 'Lấy danh sách đơn hàng thành công',
    data: result.data,
    pagination: result.pagination,
  });
});

const getOrderByIdHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const { id } = req.params;

  const order = await getOrderById(actor, id as string);

  res.status(200).json({
    success: true,
    message: 'Lấy chi tiết đơn hàng thành công',
    data: order,
  });
});

const createOrderHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const order = await createOrder(actor, req.body);

  res.status(201).json({
    success: true,
    message: 'Tạo đơn hàng thành công',
    data: order,
  });
});

const updateOrderStatusHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const { id } = req.params;
  const { orderStatus, shippingDate, userId } = req.body;

  const order = await updateOrderStatus(actor, id as string, {
    orderStatus,
    shippingDate: shippingDate ? new Date(shippingDate) : undefined,
    userId,
  });

  res.status(200).json({
    success: true,
    message: 'Cập nhật trạng thái đơn hàng thành công',
    data: order,
  });
});

const deleteOrderHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  await deleteOrder(id as string);

  res.status(200).json({
    success: true,
    message: 'Xóa đơn hàng thành công',
    data: null,
  });
});

export const orderController: Record<string, RequestHandler> = {
  getOrders: getOrdersHandler,
  getOrderById: getOrderByIdHandler,
  createOrder: createOrderHandler,
  updateOrderStatus: updateOrderStatusHandler,
  deleteOrder: deleteOrderHandler,
};