import { Router } from 'express';
import type { Router as RouterType } from 'express';

import { BrandController } from '../../../controllers/brands/brands.controller.js';
import { parseCatalogImage } from '../../../middlewares/products/catalog-image.middleware.js';
import {
  authenticate,
  requirePermission,
} from '../../../middlewares/auth/auth.middleware.js';
import { validate } from '../../../middlewares/shared/validate.middleware.js';
import { Permission } from '../../../types/shared/permissions.type.js';
import { idParamSchema } from '../../../validations/shared/common.validation.js';
import {
  createBrandSchema,
  updateBrandSchema,
} from '../../../validations/brands/brands.validation.js';

const router: RouterType = Router();

router.get('/public', BrandController.getPublic);
router.use(authenticate);

router.get(
  '/',
  requirePermission(Permission.BrandView),
  BrandController.getAll
);
router.get(
  '/:id',
  requirePermission(Permission.BrandView),
  validate({ params: idParamSchema }),
  BrandController.getById
);
router.post(
  '/',
  requirePermission(Permission.BrandCreate),
  parseCatalogImage,
  validate({ body: createBrandSchema }),
  BrandController.create
);
router.put(
  '/:id',
  requirePermission(Permission.BrandUpdate),
  validate({ params: idParamSchema }),
  parseCatalogImage,
  validate({ params: idParamSchema, body: updateBrandSchema }),
  BrandController.update
);
router.delete(
  '/:id',
  requirePermission(Permission.BrandDelete),
  validate({ params: idParamSchema }),
  BrandController.delete
);

export default router;
