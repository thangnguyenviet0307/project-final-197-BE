import { getLoginArea, matchesLoginArea } from '../utils/auth-cookie.js';
import { toAuthUser } from '../utils/user-mapper.js';
import type { Request, RequestHandler } from 'express';
import createHttpError from 'http-errors';
import { User } from '../models/users.model.js';
import { assertTemporaryPasswordValid } from '../utils/account-security.js';
import type { AuthUser } from '../types/auth.type.js';
import { Permission } from '../types/permissions.type.js';
import { hasPermission } from '../config/rolePermissions.js';
import { verifyAccessToken } from '../utils/token.js';
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw createHttpError(401, 'Token không được cung cấp');
    const decoded = verifyAccessToken(header.slice(7));
    if (decoded.accountType !== 'user')
      throw createHttpError(403, 'Administrative account required');
    const user = await User.findById(decoded.userId).select('+tokenVersion');
    if (
      !user ||
      !['super_admin', 'admin', 'staff'].includes(user.role) ||
      !user.active ||
      (user.tokenVersion ?? 0) !== decoded.version
    ) {
      throw createHttpError(401, 'Phiên đăng nhập không còn hợp lệ');
    }
    if (!matchesLoginArea(user.role, getLoginArea(req)))
      throw createHttpError(403, 'Account does not belong to this area');
    const path = req.originalUrl.split('?')[0] ?? '';
    if (path !== '/api/v1/auth/logout') assertTemporaryPasswordValid(user);
    if (
      user.mustChangePassword &&
      path === '/api/v1/auth/me' &&
      req.method !== 'GET'
    )
      throw createHttpError(403, 'Please change your temporary password first');
    if (
      user.mustChangePassword &&
      ![
        '/api/v1/auth/me',
        '/api/v1/auth/logout',
        '/api/v1/auth/change-password',
      ].includes(req.originalUrl.split('?')[0] ?? '')
    ) {
      throw createHttpError(
        403,
        'Password change required before accessing this resource'
      );
    }
    if (
      user.onboardingRequired &&
      !user.mustChangePassword &&
      ![
        '/api/v1/auth/me',
        '/api/v1/auth/logout',
        '/api/v1/auth/change-password',
        '/api/v1/auth/onboarding/profile',
        '/api/v1/auth/email-verification/send-otp',
        '/api/v1/auth/email-verification/verify-otp',
      ].includes(path)
    )
      throw createHttpError(
        403,
        'Please complete your profile and verify your personal email',
        {
          authCode: 'AUTH_ONBOARDING_REQUIRED',
        }
      );
    (req as AuthenticatedRequest).user = toAuthUser(user);
    next();
  } catch (error) {
    next(error);
  }
};
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return next(createHttpError(401, 'Chưa xác thực'));
    if (!hasPermission(user.role, permission))
      return next(createHttpError(403, 'Không có quyền truy cập'));
    next();
  };
export const optionalAuth: RequestHandler = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
};
