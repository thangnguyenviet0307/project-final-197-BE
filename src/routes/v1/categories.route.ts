import { Router, type IRouter } from "express";
import { CategoriesController } from "../../controllers/categories.controller.js";
import { validateData } from "../../middlewares/validate.middleware.js";
import { createCategoriesSchema, updateCategoriesSchema } from "../../validations/categories.validation.js";

const router: IRouter = Router();

router
  .route("/")
  .get(CategoriesController.getAllCategories)
  .post(validateData(createCategoriesSchema), CategoriesController.createCategories);

router
  .route("/:id")
  .get(CategoriesController.getCategoriesById)
  .put(validateData(updateCategoriesSchema), CategoriesController.updateCategories)
  .delete(CategoriesController.deleteCategories);

export default router;