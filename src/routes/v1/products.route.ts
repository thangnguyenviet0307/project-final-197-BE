import { objectId, paginationSchema } from "../../validations/common.validation.js";
import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import productsController, { importDummy, productMetrics, productReviews, createReview, removeReview } from "../../controllers/products.controller.js";
import {
  authenticate,
  requirePermission,
} from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { Permission } from "../../types/permissions.type.js";
import {
  updateProductFlagsSchema,
  updateInventorySchema,
  importDummyProductSchema,
  reviewInputSchema,
  storeReviewInputSchema,
  createProductSchema,
  getProductsQuerySchema,
  productIdParamSchema,
  updateProductSchema,
} from "../../validations/products.validation.js";

import { parseProductImage } from "../../middlewares/product-image.middleware.js";
import { storeProductView, storeProducts, storeProduct, storeMetrics, storeReviews, storeRelated, createStoreReview } from "../../controllers/store-products.controller.js";
import { createAuthRateLimit } from "../../middlewares/auth-rate-limit.middleware.js";
import { uploadProductImage, deleteProductImage } from "../../controllers/product-images.controller.js";

const router: ExpressRouter = Router();

// Public catalog and guest review submission precede administrative authentication.
router.get('/public', validate({ query: getProductsQuerySchema }), storeProducts);
router.get('/public/:slug', validate({ params: z.object({ slug: z.string().trim().min(3).max(255) }) }), storeProduct);
const publicSlug = z.object({ slug: z.string().trim().min(3).max(255) });
router.post('/public/:slug/views', validate({ params: publicSlug, body: z.strictObject({}) }), storeProductView);
router.get('/public/:slug/metrics', validate({ params: publicSlug }), storeMetrics);
router.get('/public/:slug/reviews', validate({ params: publicSlug, query: paginationSchema.extend({ limit: z.coerce.number().int().min(1).max(5).default(5) }) }), storeReviews);
router.post('/public/:slug/reviews', createAuthRateLimit(5, 15 * 60 * 1000, "Bạn đã gửi quá nhiều yêu cầu đánh giá. Vui lòng thử lại sau."), validate({ params: publicSlug, body: storeReviewInputSchema }), createStoreReview);
router.get('/public/:slug/related', validate({ params: publicSlug }), storeRelated);

router.use(authenticate);
router.post('/import/dummyjson', requirePermission(Permission.ProductCreate), validate({ body: importDummyProductSchema }), importDummy);
router.get('/:id/metrics', requirePermission(Permission.ProductView), validate({ params: productIdParamSchema }), productMetrics);
router.get('/:id/reviews', requirePermission(Permission.ProductView), validate({ params: productIdParamSchema, query: paginationSchema }), productReviews);
router.post('/:id/reviews', requirePermission(Permission.ProductUpdate), validate({ params: productIdParamSchema, body: reviewInputSchema }), createReview);
router.delete('/:id/reviews/:reviewId', requirePermission(Permission.ProductUpdate), validate({ params: z.object({ id: objectId, reviewId: objectId }) }), removeReview);
router.patch('/:id/flags', requirePermission(Permission.ProductUpdate),
  validate({ params: productIdParamSchema, body: updateProductFlagsSchema }), productsController.updateProduct);
router.patch('/:id/inventory', requirePermission(Permission.ProductInventory),
  validate({ params: productIdParamSchema, body: updateInventorySchema }), productsController.updateInventory);
router.get('/statistics', requirePermission(Permission.ProductView), productsController.getStatistics);
router.delete('/:id/images/:publicId', requirePermission(Permission.ProductUpdate),
  validate({ params: z.object({ id: objectId, publicId: z.string().trim().min(1).max(255) }) }), deleteProductImage);

router.post("/:id/images", requirePermission(Permission.ProductUpdate),
  validate({ params: productIdParamSchema }), parseProductImage, uploadProductImage);


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
