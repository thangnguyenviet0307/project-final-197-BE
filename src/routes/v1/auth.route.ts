import { Router, type Router as RouterType } from "express";
import { authController } from "../../controllers/auth.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  loginSchema,
  bootstrapSchema,
  refreshSchema,
} from "../../validations/auth.validation.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { createAuthRateLimit } from "../../middlewares/auth-rate-limit.middleware.js";

const router: RouterType = Router();
const rateLimit = createAuthRateLimit();

router.post(
  "/bootstrap",
  rateLimit,
  validate({ body: bootstrapSchema }),
  authController["bootstrapAdmin"]!,
);
router.post(
  "/login",
  rateLimit,
  validate({ body: loginSchema }),
  authController["login"]!,
);
router.post("/refresh", rateLimit, validate({ body: refreshSchema }), authController["refresh"]!);
router.post("/logout", authenticate, authController["logout"]!);

export default router;
