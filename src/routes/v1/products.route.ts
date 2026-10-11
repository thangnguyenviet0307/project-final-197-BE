import { Router, type Router as ExpressRouter } from "express";
import productsController from "../../controllers/products.controller.js";
import {
  validateCreateProduct,
  validateUpdateProduct,
} from "../../validations/product.validation.js";

const router: ExpressRouter = Router();

router.get("/sku/:sku", productsController.getProductBySku);
router.get(
  "/:productId/variants/:variantId",
  productsController.getVariantByProductAndVariantId,
);
router.get("/", productsController.getAllProducts);
router.post("/", validateCreateProduct, productsController.createProduct);
router.get("/:id", productsController.getProductById);
router.put("/:id", validateUpdateProduct, productsController.updateProduct);
router.delete("/:id", productsController.deleteProduct);

export default router;
