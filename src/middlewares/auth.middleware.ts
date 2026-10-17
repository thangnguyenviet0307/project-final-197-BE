import { toAuthUser } from "../utils/user-mapper.js";
import type { Request, RequestHandler } from "express";
import createHttpError from "http-errors";
import { User } from "../models/users.model.js";
import type { AuthUser } from "../types/auth.type.js";
import { Permission } from "../types/permissions.type.js";
import { hasPermission } from "../config/rolePermissions.js";
import { verifyAccessToken } from "../utils/token.js";
export interface AuthenticatedRequest extends Request { user?: AuthUser; }
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw createHttpError(401, "Token không được cung cấp");
    const decoded = verifyAccessToken(header.slice(7));
    const user = await User.findById(decoded.userId).select("+tokenVersion");
    if (!user || !user.active || (user.tokenVersion ?? 0) !== decoded.version) {
      throw createHttpError(401, "Phiên đăng nhập không còn hợp lệ");
    }
    (req as AuthenticatedRequest).user = toAuthUser(user);
    next();
  } catch (error) { next(error); }
};
export const requirePermission = (permission: Permission): RequestHandler => (req, _res, next) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return next(createHttpError(401, "Chưa xác thực"));
  if (!hasPermission(user.role, permission)) return next(createHttpError(403, "Không có quyền truy cập"));
  next();
};
export const optionalAuth: RequestHandler = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
};
