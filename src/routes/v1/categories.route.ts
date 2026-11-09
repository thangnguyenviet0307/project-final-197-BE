import { Router, type IRouter } from 'express';
import { CategoriesController } from '../../controllers/categories.controller.js';
import { parseCatalogImage } from '../../middlewares/catalog-image.middleware.js';
import {
  authenticate,
  requirePermission,
} from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { Permission } from '../../types/permissions.type.js';
import { idParamSchema } from '../../validations/common.validation.js';
import {
  createCategoriesSchema,
  deleteCategorySchema,
  updateCategoriesSchema,
} from '../../validations/categories.validation.js';

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
