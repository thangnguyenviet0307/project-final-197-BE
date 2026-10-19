import { Router, type Router as RouterType } from "express";
import { authController } from "../../controllers/auth.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  changePasswordSchema,
  loginSchema,
  bootstrapSchema,
  refreshSchema,
} from "../../validations/auth.validation.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { createAuthRateLimit } from "../../middlewares/auth-rate-limit.middleware.js";

import { parseProfileUpload } from "../../middlewares/profile-upload.middleware.js";
import { updateProfileSchema } from "../../validations/profile.validation.js";

import { cookieAuthTransport } from "../../utils/auth-cookie.js";

const router: RouterType = Router();
router.use(cookieAuthTransport);
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

router.patch("/me", authenticate, parseProfileUpload, validate({ body: updateProfileSchema }), authController["updateProfile"]!);
router.get("/me", authenticate, authController["me"]!);
router.post("/change-password", authenticate, rateLimit, validate({ body: changePasswordSchema }), authController["changePassword"]!);

export default router;
