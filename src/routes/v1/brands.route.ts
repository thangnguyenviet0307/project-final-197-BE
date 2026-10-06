import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { BrandController } from '../../controllers/brands.controller.js';

const router: RouterType = Router();

router.get('/', BrandController.getAll);
router.get('/:id', BrandController.getById);
router.post('/', BrandController.create);
router.put('/:id', BrandController.update);
router.delete('/:id', BrandController.delete);

export default router;