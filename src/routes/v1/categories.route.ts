import { Router, type IRouter } from "express";
import { CategoriesController } from "../../controllers/categories.controller.js";
import {
  authenticate,
  requirePermission,
} from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { Permission } from "../../types/permission.type.js";
import { idParamSchema } from "../../validations/common.validation.js";
import {
  createCategoriesSchema,
  updateCategoriesSchema,
} from "../../validations/categories.validation.js";

const router: IRouter = Router();

router.use(authenticate);

router
  .route("/")
  .get(
    requirePermission(Permission.CategoryView),
    CategoriesController.getAllCategories,
  )
  .post(
    requirePermission(Permission.CategoryCreate),
    validate({ body: createCategoriesSchema }),
    CategoriesController.createCategories,
  );

router
  .route("/:id")
  .get(
    requirePermission(Permission.CategoryView),
    validate({ params: idParamSchema }),
    CategoriesController.getCategoriesById,
  )
  .put(
    requirePermission(Permission.CategoryUpdate),
    validate({ params: idParamSchema, body: updateCategoriesSchema }),
    CategoriesController.updateCategories,
  )
  .delete(
    requirePermission(Permission.CategoryDelete),
    validate({ params: idParamSchema }),
    CategoriesController.deleteCategories,
  );

export default router;
