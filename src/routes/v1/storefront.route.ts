import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.middleware.js";
import { getProductBySlug, getRecommendations, publicProductReviews } from "../../controllers/storefront.controller.js";

import { paginationSchema } from "../../validations/common.validation.js";
import { createGuestCheckout } from "../../controllers/checkout.controller.js";
import { checkoutSchema } from "../../validations/checkout.validation.js";
import { createAuthRateLimit } from "../../middlewares/auth-rate-limit.middleware.js";

const router: ExpressRouter = Router();
router.post("/checkout", createAuthRateLimit(5, 15 * 60 * 1000, "Bạn đã gửi nhiều yêu cầu đặt hàng. Vui lòng thử lại sau."), validate({ body: checkoutSchema }), createGuestCheckout);
// Public read-only DTO. Staff catalog routes retain their authentication/permissions.
router.get("/products/:slug", validate({ params: z.object({ slug: z.string().trim().min(3).max(255) }) }), getProductBySlug);
router.get("/products/:slug/recommendations", validate({ params: z.object({ slug: z.string().trim().min(3).max(255) }) }), getRecommendations);
router.get("/products/:slug/reviews", validate({ params: z.object({ slug: z.string().trim().min(3).max(255) }), query: paginationSchema }), publicProductReviews);
export default router;
