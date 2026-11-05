import type { RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { sendResponse } from '../helpers/response.helper.js';
import { asyncHandler } from '../utils/async-handler.util.js';
import {
  sendCustomerOtp,
  verifyCustomerOtp,
  resetCustomerPassword,
  sendEmailVerification,
  verifyPersonalEmail,
} from '../services/account-security.service.js';

export const accountSecurityController: Record<string, RequestHandler> = {
  sendOtp: asyncHandler(async (req, res) => {
    await sendCustomerOtp(req.body.email);
    sendResponse(res, 200, {
      message: 'Nếu email đã đăng ký và đủ điều kiện, mã xác nhận sẽ được gửi.',
      data: { retryAfter: 60, expiresIn: 300 },
    });
  }),
  verifyOtp: asyncHandler(async (req, res) => {
    const data = await verifyCustomerOtp(req.body.email, req.body.otp);
    sendResponse(res, 200, { message: 'Mã xác nhận hợp lệ.', data });
  }),
  resetPassword: asyncHandler(async (req, res) => {
    await resetCustomerPassword(req.body);
    sendResponse(res, 200, {
      message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.',
      data: null,
    });
  }),
  sendEmailVerification: asyncHandler(async (req, res) => {
    await sendEmailVerification((req as AuthenticatedRequest).user!);
    sendResponse(res, 200, {
      message: 'Đã gửi mã xác nhận email.',
      data: { retryAfter: 60, expiresIn: 300 },
    });
  }),
  verifyEmail: asyncHandler(async (req, res) => {
    await verifyPersonalEmail(
      (req as AuthenticatedRequest).user!,
      req.body.otp
    );
    sendResponse(res, 200, {
      message: 'Đã xác nhận email cá nhân.',
      data: null,
    });
  }),
};
