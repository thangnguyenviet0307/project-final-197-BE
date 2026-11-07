import { accountSecurityController as security } from '../../../controllers/auth/account-security.controller.js';
import {
  sendOtpSchema,
  verifyOtpSchema,
  resetPasswordSchema,
} from '../../../validations/auth/account-security.validation.js';
import { idParamSchema } from '../../../validations/shared/common.validation.js';
import { checkoutSchema } from '../../../validations/orders/checkout.validation.js';
import { Router, type Router as ExpressRouter } from 'express';
import {
  createCheckout,
  checkoutLocations,
} from '../../../controllers/orders/checkout.controller.js';
import { cancelCustomerOrderController } from '../../../controllers/orders/customer-order-cancel.controller.js';
import { cancelCustomerOrderSchema } from '../../../validations/orders/customer-order-cancel.validation.js';
import createHttpError from 'http-errors';
import {
  customerProfileSchema,
  shippingAddressSchema,
  customerOrdersQuerySchema,
} from '../../../validations/customers/customer-account.validation.js';
import {
  cookieAuthTransport,
  getLoginArea,
} from '../../../utils/auth/auth-cookie.js';
import { authenticateCustomer } from '../../../middlewares/customers/customer-auth.middleware.js';
import { validate } from '../../../middlewares/shared/validate.middleware.js';
import { createAuthRateLimit } from '../../../middlewares/auth/auth-rate-limit.middleware.js';
import { customerAuthController as controller } from '../../../controllers/customers/customer-auth.controller.js';
import {
  registerCustomerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} from '../../../validations/auth/auth.validation.js';

const router: ExpressRouter = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.use((req, _res, next) => {
  try {
    if (getLoginArea(req) !== 'storefront')
      throw createHttpError(403, 'Storefront authentication required');
    next();
  } catch (error) {
    next(error);
  }
});
router.use(cookieAuthTransport);
const rateLimit = createAuthRateLimit();

router.post(
  '/register',
  rateLimit,
  validate({ body: registerCustomerSchema }),
  controller.register
);
router.post(
  '/login',
  rateLimit,
  validate({ body: loginSchema }),
  controller.login
);
router.post(
  '/refresh',
  rateLimit,
  validate({ body: refreshSchema }),
  controller.refresh
);
router.get('/me', authenticateCustomer, controller.me);
router.patch(
  '/me',
  authenticateCustomer,
  validate({ body: customerProfileSchema }),
  controller.profile
);
router.patch(
  '/shipping-address',
  authenticateCustomer,
  validate({ body: shippingAddressSchema }),
  controller.shippingAddress
);
router.get(
  '/orders',
  authenticateCustomer,
  validate({ query: customerOrdersQuerySchema }),
  controller.orders
);
router.patch(
  '/orders/:id/cancel',
  authenticateCustomer,
  validate({ params: idParamSchema, body: cancelCustomerOrderSchema }),
  cancelCustomerOrderController
);
router.get('/checkout-locations', checkoutLocations);
router.post(
  '/orders',
  authenticateCustomer,
  rateLimit,
  validate({ body: checkoutSchema }),
  createCheckout
);
router.post('/logout', authenticateCustomer, controller.logout);
router.post(
  '/change-password',
  authenticateCustomer,
  rateLimit,
  validate({ body: changePasswordSchema }),
  controller.password
);

const recoveryIpLimit = createAuthRateLimit(30);
const recoveryEmailLimit = createAuthRateLimit(
  10,
  15 * 60 * 1000,
  'Too many recovery requests',
  (req) => req.body.email
);
router.post(
  '/send-otp',
  recoveryIpLimit,
  validate({ body: sendOtpSchema }),
  recoveryEmailLimit,
  security['sendOtp']!
);
router.post(
  '/verify-otp',
  recoveryIpLimit,
  validate({ body: verifyOtpSchema }),
  recoveryEmailLimit,
  security['verifyOtp']!
);
router.post(
  '/reset-password',
  recoveryIpLimit,
  validate({ body: resetPasswordSchema }),
  recoveryEmailLimit,
  security['resetPassword']!
);
export default router;
