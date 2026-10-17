import { objectId } from "../../validations/common.validation.js";
import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import productsController from "../../controllers/products.controller.js";
import {
  authenticate,
  requirePermission,
} from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { Permission } from "../../types/permissions.type.js";
import {
  createProductSchema,
  getProductsQuerySchema,
  productIdParamSchema,
  updateProductSchema,
} from "../../validations/products.validation.js";

const router: ExpressRouter = Router();

router.use(authenticate);

router.get(
  "/sku/:sku",
  requirePermission(Permission.ProductView),
  validate({ params: z.object({ sku: z.string().trim().min(1) }) }),
  productsController.getProductBySku,
);
router.get(
  "/:productId/variants/:variantId",
  requirePermission(Permission.ProductView),
  validate({
    params: z.object({
      productId: objectId,
      variantId: objectId,
    }),
  }),
  productsController.getVariantByProductAndVariantId,
);
router.get(
  "/",
  requirePermission(Permission.ProductView),
  validate({ query: getProductsQuerySchema }),
  productsController.getAllProducts,
);
router.post(
  "/",
  requirePermission(Permission.ProductCreate),
  validate({ body: createProductSchema }),
  productsController.createProduct,
);
router.get(
  "/:id",
  requirePermission(Permission.ProductView),
  validate({ params: productIdParamSchema }),
  productsController.getProductById,
);
router.put(
  "/:id",
  requirePermission(Permission.ProductUpdate),
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  productsController.updateProduct,
);
router.delete(
  "/:id",
  requirePermission(Permission.ProductDelete),
  validate({ params: productIdParamSchema }),
  productsController.deleteProduct,
);

export default router;
