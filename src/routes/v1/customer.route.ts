import { Router, type Router as RouterType } from 'express';
import { customerController } from '../../controllers/customer.controller.js';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { Permission } from '../../types/permission.type.js';
import { idParamSchema } from '../../validations/common.validation.js';
import {
  createCustomerSchema,
  getCustomersQuerySchema,
  updateCustomerSchema,
} from '../../validations/customer.validation.js';

const router: RouterType = Router();

router.use(authenticate);

router.get('/', requirePermission(Permission.CustomerView), validate({ query: getCustomersQuerySchema }), customerController['getCustomers']!);
router.get('/:id', requirePermission(Permission.CustomerView), validate({ params: idParamSchema }), customerController['getCustomerById']!);
router.post('/', requirePermission(Permission.CustomerCreate), validate({ body: createCustomerSchema }), customerController['createCustomer']!);
router.put(
  '/:id',
  requirePermission(Permission.CustomerUpdate),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  customerController['updateCustomer']!,
);
router.delete(
  '/:id',
  requirePermission(Permission.CustomerDelete),
  validate({ params: idParamSchema }),
  customerController['deleteCustomer']!,
);

export default router;