import { idParamSchema } from "../../validations/common.validation.js";
import { checkoutSchema } from "../../validations/checkout.validation.js";
import { cancelCustomerOrderSchema } from "../../validations/orders.validation.js";
import { Router, type Router as ExpressRouter } from "express";
import createHttpError from "http-errors";
import { customerProfileSchema, shippingAddressSchema, customerOrdersQuerySchema } from "../../validations/customer-account.validation.js";
import { cookieAuthTransport, getLoginArea } from "../../utils/auth-cookie.js";
import { authenticateCustomer } from "../../middlewares/customer-auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { createAuthRateLimit } from "../../middlewares/auth-rate-limit.middleware.js";
import { customerAuthController as controller } from "../../controllers/customer-auth.controller.js";
import { registerCustomerSchema, loginSchema, refreshSchema, changePasswordSchema } from "../../validations/auth.validation.js";


const router: ExpressRouter = Router();
router.use((req, _res, next) => {
  try { if (getLoginArea(req) !== "storefront") throw createHttpError(403, "Storefront authentication required"); next(); } catch (error) { next(error); }
});
router.use(cookieAuthTransport);
const rateLimit = createAuthRateLimit();

router.post("/register", rateLimit, validate({ body: registerCustomerSchema }), controller.register);
router.post("/login", rateLimit, validate({ body: loginSchema }), controller.login);
router.post("/refresh", rateLimit, validate({ body: refreshSchema }), controller.refresh);
router.get("/me", authenticateCustomer, controller.me);
router.patch("/me", authenticateCustomer, validate({ body: customerProfileSchema }), controller.profile);
router.patch("/shipping-address", authenticateCustomer, validate({ body: shippingAddressSchema }), controller.shippingAddress);
router.get("/checkout-locations", controller.checkoutLocations);
router.post("/orders", authenticateCustomer, validate({ body: checkoutSchema }), controller.checkout);
router.patch("/orders/:id/cancel", authenticateCustomer, validate({ params: idParamSchema, body: cancelCustomerOrderSchema }), controller.cancelOrder);
router.get("/orders", authenticateCustomer, validate({ query: customerOrdersQuerySchema }), controller.orders);
router.post("/logout", authenticateCustomer, controller.logout);
router.post("/change-password", authenticateCustomer, rateLimit, validate({ body: changePasswordSchema }), controller.password);
export default router;
