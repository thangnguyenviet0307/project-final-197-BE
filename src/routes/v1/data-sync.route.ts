import { Router, type Router as RouterType } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { streamDataChanges } from '../../controllers/data-sync.controller.js';

const router: RouterType = Router();
router.get('/events', authenticate, streamDataChanges);
export default router;
