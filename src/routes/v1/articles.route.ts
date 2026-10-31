import { Router, type Router as ExpressRouter } from "express";
import { authenticate, requirePermission } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { Permission } from "../../types/permissions.type.js";
import { createAuthRateLimit } from "../../middlewares/auth-rate-limit.middleware.js";
import {
  adminArticleQuerySchema,
  articleIdParamSchema,
  articleSlugParamSchema,
  articleVersionSchema,
  createArticleSchema,
  publicArticleQuerySchema,
  updateArticleSchema,
} from "../../validations/articles.validation.js";
import * as controller from "../../controllers/articles.controller.js";

const router: ExpressRouter = Router();

router.get("/public/categories", controller.publicArticleCategories);
router.get("/public/tags", controller.publicArticleTags);
router.get("/public", validate({ query: publicArticleQuerySchema }), controller.publicArticles);
router.post(
  "/public/:slug/views",
  createAuthRateLimit(60, 15 * 60 * 1000, "Bạn đã ghi nhận quá nhiều lượt xem. Vui lòng thử lại sau."),
  validate({ params: articleSlugParamSchema }),
  controller.recordArticleView,
);
router.get("/public/:slug", validate({ params: articleSlugParamSchema }), controller.publicArticle);

router.use(authenticate, requirePermission(Permission.ArticleManage));
router.get("/stats", controller.articleStats);
router.get("/categories", controller.adminArticleCategories);
router.get("/tags", controller.adminArticleTags);
router.get("/", validate({ query: adminArticleQuerySchema }), controller.adminArticles);
router.post("/", validate({ body: createArticleSchema }), controller.createArticle);
router.get("/:id", validate({ params: articleIdParamSchema }), controller.adminArticle);
router.patch("/:id", validate({ params: articleIdParamSchema, body: updateArticleSchema }), controller.updateArticle);
router.delete("/:id", validate({ params: articleIdParamSchema, body: articleVersionSchema }), controller.deleteArticle);

export default router;
