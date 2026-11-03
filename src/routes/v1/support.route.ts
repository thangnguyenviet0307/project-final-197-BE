import {
  Router,
  type RequestHandler,
  type Router as ExpressRouter,
} from 'express';
import createHttpError from 'http-errors';
import {
  authenticate,
  type AuthenticatedRequest,
} from '../../middlewares/auth.middleware.js';
import { authenticateCustomer } from '../../middlewares/customer-auth.middleware.js';
import { createAuthRateLimit } from '../../middlewares/auth-rate-limit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { parseProductImage } from '../../middlewares/product-image.middleware.js';
import { idParamSchema } from '../../validations/common.validation.js';
import {
  createWarrantySchema,
  savePolicySchema,
  supportListSchema,
  updateWarrantySchema,
} from '../../validations/support.validation.js';
import * as controller from '../../controllers/support.controller.js';
import * as information from '../../controllers/information.controller.js';
import {
  informationParams,
  saveInformationSchema,
} from '../../validations/information.validation.js';
import * as documents from '../../controllers/managed-document.controller.js';
import {
  documentParams,
  documentInput,
  documentVersion,
} from '../../validations/managed-document.validation.js';

const router: ExpressRouter = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
const adminOnly: RequestHandler = (req, _res, next) => {
  if (
    !['super_admin', 'admin'].includes(
      (req as AuthenticatedRequest).user?.role ?? ''
    )
  )
    return next(
      createHttpError(403, 'Chỉ quản trị viên được chỉnh sửa chính sách.')
    );
  next();
};
const rateLimit = createAuthRateLimit(
  20,
  15 * 60000,
  'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.'
);
router.get('/policy', controller.publicPolicy);
router.get(
  '/documents/:key',
  validate({ params: documentParams }),
  documents.publicDetail
);
router.post(
  '/documents/:key/views',
  createAuthRateLimit(120, 60000, 'Vui lòng thử lại sau.'),
  validate({ params: documentParams }),
  documents.view
);
router.get('/admin/documents', authenticate, adminOnly, documents.list);
router.get(
  '/admin/documents/:key',
  authenticate,
  adminOnly,
  validate({ params: documentParams }),
  documents.detail
);
router.put(
  '/admin/documents/:key',
  authenticate,
  adminOnly,
  validate({ params: documentParams, body: documentInput }),
  documents.save
);
router.delete(
  '/admin/documents/:key',
  authenticate,
  adminOnly,
  validate({ params: documentParams, body: documentVersion }),
  documents.remove
);
router.get(
  '/pages/:slug',
  validate({ params: informationParams }),
  information.publicInformation
);
router.get(
  '/admin/pages/:slug',
  authenticate,
  adminOnly,
  validate({ params: informationParams }),
  information.adminInformation
);
router.put(
  '/admin/pages/:slug',
  authenticate,
  adminOnly,
  validate({ params: informationParams, body: saveInformationSchema }),
  information.saveInformation
);
router.get('/admin/policy', authenticate, adminOnly, controller.adminPolicy);
router.put(
  '/admin/policy',
  authenticate,
  adminOnly,
  validate({ body: savePolicySchema }),
  controller.savePolicy
);
router.get(
  '/customer/eligible-orders',
  authenticateCustomer,
  validate({ query: supportListSchema }),
  controller.eligibleOrders
);
router.get(
  '/customer/requests',
  authenticateCustomer,
  validate({ query: supportListSchema }),
  controller.customerList
);
router.post(
  '/customer/requests',
  authenticateCustomer,
  rateLimit,
  validate({ body: createWarrantySchema }),
  controller.createWarranty
);
router.get(
  '/customer/requests/:id',
  authenticateCustomer,
  validate({ params: idParamSchema }),
  controller.customerDetail
);
router.post(
  '/customer/requests/:id/images',
  authenticateCustomer,
  rateLimit,
  validate({ params: idParamSchema }),
  parseProductImage,
  controller.uploadImage
);
router.get(
  '/admin/requests',
  authenticate,
  validate({ query: supportListSchema }),
  controller.adminList
);
router.get(
  '/admin/requests/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.adminDetail
);
router.patch(
  '/admin/requests/:id',
  authenticate,
  validate({ params: idParamSchema, body: updateWarrantySchema }),
  controller.updateWarranty
);
export default router;
