import { Router, type Router as ExpressRouter } from 'express';
import {
  authenticate,
  requirePermission,
} from '../../../middlewares/auth/auth.middleware.js';
import { createAuthRateLimit } from '../../../middlewares/auth/auth-rate-limit.middleware.js';
import { parseProductImage } from '../../../middlewares/products/product-image.middleware.js';
import { Permission } from '../../../types/shared/permissions.type.js';
import { uploadImage } from '../../../controllers/editor/editor.controller.js';

const router: ExpressRouter = Router();
router.post(
  '/images',
  authenticate,
  requirePermission(Permission.ContentUpload),
  createAuthRateLimit(20, 60000),
  parseProductImage,
  uploadImage
);
export default router;
