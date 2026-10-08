
import { Router } from 'express';
import type { Router as RouterType } from 'express';

import { BrandController } from '../../controllers/brands.controller.js';

import { validate } from '../../middlewares/validate.middleware.js';

import {
  createBrandSchema,
  updateBrandSchema,
} from '../../validations/brands.validation.js';

const router: RouterType = Router();

// GET: Lấy danh sách thương hiệu
router.get('/', BrandController.getAll);

// GET: Lấy thương hiệu theo ID
router.get('/:id', BrandController.getById);

// POST: Tạo thương hiệu (validate bằng Zod)
router.post(
  '/',
  validate(createBrandSchema),
  BrandController.create
);

// PUT: Cập nhật thương hiệu (validate bằng Zod)
router.put(
  '/:id',
  validate(updateBrandSchema),
  BrandController.update
);

// DELETE: Xóa thương hiệu
router.delete('/:id', BrandController.delete);

export default router;
