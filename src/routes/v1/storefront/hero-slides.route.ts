import { Router, type Router as ExpressRouter } from 'express';
import {
  authenticate,
  requirePermission,
} from '../../../middlewares/auth/auth.middleware.js';
import { validate } from '../../../middlewares/shared/validate.middleware.js';
import { idParamSchema } from '../../../validations/shared/common.validation.js';
import {
  createHeroSlideSchema,
  updateHeroSlideSchema,
  heroSlideVersionSchema,
} from '../../../validations/storefront/hero-slides.validation.js';
import { Permission } from '../../../types/shared/permissions.type.js';
import * as controller from '../../../controllers/storefront/hero-slides.controller.js';
const router: ExpressRouter = Router();
router.get('/public', controller.publicHeroSlides);
router.use(authenticate, requirePermission(Permission.HeroManage));
router.get('/', controller.heroSlides);
router.post(
  '/',
  validate({ body: createHeroSlideSchema }),
  controller.createHeroSlide
);
router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateHeroSlideSchema }),
  controller.updateHeroSlide
);
router.delete(
  '/:id',
  validate({ params: idParamSchema, body: heroSlideVersionSchema }),
  controller.deleteHeroSlide
);
export default router;
