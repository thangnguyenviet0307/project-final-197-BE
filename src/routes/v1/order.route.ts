import { Router, type Router as RouterType } from 'express';
import { orderController } from '../../controllers/order.controller.js';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { Permission } from '../../types/permission.type.js';
import { idParamSchema } from '../../validations/common.validation.js';
import {
  createOrderSchema,
  getOrdersQuerySchema,
  updateOrderStatusSchema,
} from '../../validations/order.validation.js';

const router: RouterType = Router();

router.use(authenticate); // phạm vi dữ liệu theo quyền (orders:view-all) được xử lý trong service

router.get('/', requirePermission(Permission.OrderView), validate({ query: getOrdersQuerySchema }), orderController['getOrders']!);
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

export default router;