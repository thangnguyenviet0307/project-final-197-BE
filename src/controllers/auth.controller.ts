import { toPublicUser } from "../utils/user-mapper.js";
import type { AuthenticatedRequest } from "../middlewares/auth.middleware.js";
import { changePassword } from "../services/auth.service.js";
import createHttpError from "http-errors";
import { sendResponse } from "../helpers/response.helper.js";
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

    sendResponse(res, 200, {
      success: true,
      message: "Đăng nhập thành công",
      data: result,
    });
  },
);

const bootstrapAdminHandler: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await bootstrapAdminService(req.body, req.get("x-bootstrap-secret"));

    sendResponse(res, 201, {
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

    sendResponse(res, 200, {
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
      sendResponse(res, 400, { success: false, message: "Refresh token là bắt buộc" });
      return;
    }
    const result = await refreshService(refreshToken);

    sendResponse(res, 200, {
      success: true,
      message: "Làm mới token thành công",
      data: result,
    });
  },
);

export const authController: Record<string, RequestHandler> = {
  me: asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) throw createHttpError(401, "Authentication required");
    sendResponse(res, 200, { data: toPublicUser(user) });
  }),
  changePassword: asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) throw createHttpError(401, "Authentication required");
    await changePassword(user.id, req.body);
    sendResponse(res, 200, { message: "Password changed. Please sign in again.", data: null });
  }),
  login: loginHandler,
  bootstrapAdmin: bootstrapAdminHandler,
  logout: logoutHandler,
  refresh: refreshHandler,
};
