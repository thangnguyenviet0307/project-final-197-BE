import { sendResponse } from "../helpers/response.helper.js";
import type { Response, RequestHandler } from 'express';
import {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  deleteOrder,
  assignOrder,
} from '../services/orders.services.js';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import type { GetOrdersQuery, UpdateOrderStatusInput } from '../types/orders.type.js';
import { asyncHandler } from '../utils/async-handler.util.js';

const getOrdersHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const result = await getOrders(actor, req.query as unknown as GetOrdersQuery);

  sendResponse(res, 200, {
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

  sendResponse(res, 200, {
    success: true,
    message: 'Lấy chi tiết đơn hàng thành công',
    data: order,
  });
});

const createOrderHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const order = await createOrder(actor, req.body);

  sendResponse(res, 201, {
    success: true,
    message: 'Tạo đơn hàng thành công',
    data: order,
  });
});

const updateOrderStatusHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const { id } = req.params;
  const order = await updateOrderStatus(actor, id as string, req.body as UpdateOrderStatusInput);

  sendResponse(res, 200, {
    success: true,
    message: 'Cập nhật trạng thái đơn hàng thành công',
    data: order,
  });
});

const deleteOrderHandler: RequestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  await deleteOrder(id as string);

  sendResponse(res, 200, {
    success: true,
    message: 'Xóa đơn hàng thành công',
    data: null,
  });
});

export const orderController: Record<string, RequestHandler> = {
  assignOrder: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const order = await assignOrder(req.user!, req.params['id'] as string, req.body.userId);
    sendResponse(res, 200, { success: true, message: 'Order reassigned', data: order });
  }),
  getOrders: getOrdersHandler,
  getOrderById: getOrderByIdHandler,
  createOrder: createOrderHandler,
  updateOrderStatus: updateOrderStatusHandler,
  deleteOrder: deleteOrderHandler,
};
