import { Router, type IRouter } from 'express';
import { CategoriesController } from '../../../controllers/categories/categories.controller.js';
import { parseCatalogImage } from '../../../middlewares/products/catalog-image.middleware.js';
import {
  authenticate,
  requirePermission,
} from '../../../middlewares/auth/auth.middleware.js';
import { validate } from '../../../middlewares/shared/validate.middleware.js';
import { Permission } from '../../../types/shared/permissions.type.js';
import { idParamSchema } from '../../../validations/shared/common.validation.js';
import {
  createCategoriesSchema,
  deleteCategorySchema,
  updateCategoriesSchema,
} from '../../../validations/categories/categories.validation.js';

const router: IRouter = Router();

router.get('/public', CategoriesController.getPublicCategories);

router.use(authenticate);

router
  .route('/')
  .get(
    requirePermission(Permission.CategoryView),
    CategoriesController.getAllCategories
  )
  .post(
    requirePermission(Permission.CategoryCreate),
    parseCatalogImage,
    validate({ body: createCategoriesSchema }),
    CategoriesController.createCategories
  );

router
  .route('/:id')
  .get(
    requirePermission(Permission.CategoryView),
    validate({ params: idParamSchema }),
    CategoriesController.getCategoriesById
  )
  .put(
    requirePermission(Permission.CategoryUpdate),
    validate({ params: idParamSchema }),
    parseCatalogImage,
    validate({ params: idParamSchema, body: updateCategoriesSchema }),
    CategoriesController.updateCategories
  )
  .delete(
    requirePermission(Permission.CategoryDelete),
    validate({ params: idParamSchema, body: deleteCategorySchema.optional() }),
    CategoriesController.deleteCategories
  );

export default router;
