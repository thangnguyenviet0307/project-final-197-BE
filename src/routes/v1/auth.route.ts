import { Router } from 'express';
import authController from '../../controllers/auth.controller.js';
import { loginSchema, registerSchema } from '../../validations/auth.validation.js';
import { validateData } from '../../middlewares/validate.middleware.js';

const router: ReturnType<typeof Router> = Router();

// Route đăng nhập: Được kiểm tra qua validateData(loginSchema) trước khi vào controller
router.post('/login', validateData(loginSchema), authController.login);

// Route đăng ký: Được kiểm tra qua validateData(registerSchema) trước khi vào controller
router.post('/register', validateData(registerSchema), authController.register);

export default router;