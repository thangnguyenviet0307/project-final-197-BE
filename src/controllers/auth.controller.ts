import type { Request, Response, RequestHandler } from "express";
import {
  login as loginService,
  logout as logoutService,
  refresh as refreshService,
  bootstrapAdmin as bootstrapAdminService,
} from "../services/auth.service.js";
import { asyncHandler } from "../utils/async-handler.util.js";

const loginHandler: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await loginService(email, password);

    res.status(200).json({
      success: true,
      message: "Đăng nhập thành công",
      data: result,
    });
  },
);

const bootstrapAdminHandler: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await bootstrapAdminService(req.body);

    res.status(201).json({
      success: true,
      message: "Tạo admin đầu tiên thành công",
      data: result,
    });
  },
);

const logoutHandler: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const user = (req as { user?: { id: string } }).user;
    if (user) await logoutService(user.id);

    res.status(200).json({
      success: true,
      message: "Đăng xuất thành công",
      data: null,
    });
  },
);

const refreshHandler: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res
        .status(400)
        .json({ success: false, message: "Refresh token là bắt buộc" });
      return;
    }
    const result = await refreshService(refreshToken);

    res.status(200).json({
      success: true,
      message: "Làm mới token thành công",
      data: result,
    });
  },
);

export const authController: Record<string, RequestHandler> = {
  login: loginHandler,
  bootstrapAdmin: bootstrapAdminHandler,
  logout: logoutHandler,
  refresh: refreshHandler,
};
