import { updateOrderNoteSchema } from "../../validations/orders.validation.js";
import { Router, type Router as RouterType } from 'express';
import createHttpError from 'http-errors';
import { orderController } from '../../controllers/orders.controller.js';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { Permission } from '../../types/permissions.type.js';
import { idParamSchema } from '../../validations/common.validation.js';
import {
  createOrderSchema,
  getOrdersQuerySchema,
  updateOrderStatusSchema,
  assignOrderSchema,
  startOrderSchema,
  updateOrderDatesSchema,
} from '../../validations/orders.validation.js';

const router: RouterType = Router();

router.use(authenticate); // phạm vi dữ liệu theo quyền (orders:view-all) được xử lý trong service

router.get('/personal-sales', requirePermission(Permission.OrderView), orderController['getPersonalSales']!);
router.patch('/:id/note', requirePermission(Permission.OrderNote), validate({ params: idParamSchema, body: updateOrderNoteSchema }), orderController['updateOrderNote']!);
router.get('/',  requirePermission(Permission.OrderView), validate({ query: getOrdersQuerySchema }), orderController['getOrders']!);
router.get('/:id', requirePermission(Permission.OrderView), validate({ params: idParamSchema }), orderController['getOrderById']!);
router.post('/', requirePermission(Permission.OrderCreate), validate({ body: createOrderSchema }), orderController['createOrder']!);
router.patch(
  '/:id/status',
  requirePermission(Permission.OrderUpdateStatus),
  validate({ params: idParamSchema, body: updateOrderStatusSchema }),
  orderController['updateOrderStatus']!,
);
router.delete(
  '/:id',
  requirePermission(Permission.OrderDelete),
  validate({ params: idParamSchema }),
  orderController['deleteOrder']!,
);
router.patch('/:id/assignee', requirePermission(Permission.OrderAssign),
  validate({ params: idParamSchema, body: assignOrderSchema }), orderController['assignOrder']!);

router.patch('/:id/start', requirePermission(Permission.OrderStart),
  validate({ params: idParamSchema, body: startOrderSchema }), orderController['startOrder']!);

router.patch('/:id/dates', requirePermission(Permission.OrderUpdateDates),
  validate({ params: idParamSchema, body: updateOrderDatesSchema }), orderController['updateOrderDates']!);

// A wrong method on a known endpoint should not look like a missing order.
router.all('/', (_req, res, next) => {
  res.setHeader('Allow', 'GET, POST');
  next(createHttpError(405, 'Use GET or POST /api/v1/orders'));
});
router.all('/:id/status', (_req, res, next) => {
  res.setHeader('Allow', 'PATCH');
  next(createHttpError(405, 'Use PATCH /api/v1/orders/:id/status'));
});
router.all('/:id', (req, res, next) => {
  res.setHeader('Allow', 'GET, DELETE');
  next(createHttpError(405, req.method === 'POST'
    ? 'Create an order with POST /api/v1/orders, without an ID or /create suffix'
    : 'Use GET or DELETE /api/v1/orders/:id; update status with PATCH /api/v1/orders/:id/status'));
});

export default router;
