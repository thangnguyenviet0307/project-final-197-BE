import { Router, type Router as RouterType } from "express";
import { authController } from "../../controllers/auth.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  loginSchema,
  bootstrapSchema,
} from "../../validations/auth.validation.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

const router: RouterType = Router();

router.post(
  "/bootstrap",
  validate({ body: bootstrapSchema }),
  authController["bootstrapAdmin"]!,
);
router.post(
  "/login",
  validate({ body: loginSchema }),
  authController["login"]!,
);
router.post("/refresh", authController["refresh"]!);
router.post("/logout", authenticate, authController["logout"]!);

export default router;
