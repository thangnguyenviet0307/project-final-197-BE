import type { Request, RequestHandler } from "express";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import createHttpError from "http-errors";
import { User } from "../models/user.model.js";
import type { AuthUser } from "../types/auth.type.js";
import { Permission } from "../types/permission.type.js";
import { hasPermission } from "../config/rolePermissions.js";

dotenv.config();

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const JWT_SECRET = getRequiredEnv("JWT_SECRET");
const JWT_REFRESH_SECRET = getRequiredEnv("JWT_REFRESH_SECRET");

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw createHttpError(401, "Token không được cung cấp");
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      throw createHttpError(401, "Token không được cung cấp");
    }
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;

    const user = await User.findById(decoded.userId).select("-password");
    if (!user || !user.active) {
      throw createHttpError(401, "Người dùng không tồn tại hoặc đã bị khóa");
    }

    (req as AuthenticatedRequest).user = {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      active: user.active,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(createHttpError(401, "Token không hợp lệ"));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(createHttpError(401, "Token đã hết hạn"));
    } else {
      next(error);
    }
  }
};

export const requirePermission = (permission: Permission): RequestHandler => {
  return (req, _res, next) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return next(createHttpError(401, "Chưa xác thực"));
    }

    if (!hasPermission(user.role, permission)) {
      return next(createHttpError(403, "Không có quyền truy cập"));
    }

    next();
  };
};

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return next();
    }
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;

    const user = await User.findById(decoded.userId).select("-password");
    if (user && user.active) {
      (req as AuthenticatedRequest).user = {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        active: user.active,
      };
    }
    next();
  } catch {
    next();
  }
};

export function generateAccessToken(user: AuthUser): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "15m" },
  );
}

export function generateRefreshToken(user: AuthUser): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_REFRESH_SECRET,
    { expiresIn: "7d" },
  );
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as unknown as JwtPayload;
}
