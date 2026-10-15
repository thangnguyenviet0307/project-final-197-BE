import { type NextFunction, type Request, type Response } from 'express';
import authService from '../services/auth.service.js';

const login = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const { email, password } = req.body;
        const result = await authService.login(email, password);

        return res.status(200).json({
            success: true,
            message: "Đăng nhập thành công!",
            data: result
        });
    } catch (error) {
        return next(error);
    }
};

const register = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const { fullName, email, password,} = req.body;
        const result = await authService.register({ name: fullName, email, password,});

        return res.status(201).json({
            success: true,
            message: "Đăng ký thành công!",
            data: result
        });
    } catch (error) {
        return next(error);
    }
};

export default {
    login,
    register,
};