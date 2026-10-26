import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.middleware.js";
import { getProductBySlug, getRecommendations } from "../../controllers/storefront.controller.js";

const router: ExpressRouter = Router();
// Public read-only DTO. Staff catalog routes retain their authentication/permissions.
router.get("/products/:slug", validate({ params: z.object({ slug: z.string().trim().min(3).max(255) }) }), getProductBySlug);
router.get("/products/:slug/recommendations", validate({ params: z.object({ slug: z.string().trim().min(3).max(255) }) }), getRecommendations);
export default router;
