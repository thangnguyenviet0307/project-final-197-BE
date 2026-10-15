import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import createError from "http-errors";

// Mở rộng interface Request để TypeScript nhận diện được req.user
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: "admin" | "staff";
  };
}

// Middleware xác thực Token đăng nhập
 export const verifyToken = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(createError(401, "Vui lòng đăng nhập để tiếp tục!"));
  }

  const token = authHeader.split(" ")[1] as string;
  const secretKey: string = (process.env["JWT_SECRET"] as string) || "default_secret_key_123";

  try {
    const decoded = jwt.verify(token, secretKey) as unknown as {
      id: string;
      role: "admin" | "staff";
    };

    req.user = decoded;
    next();
  } catch (error) {
    return next(createError(403, "Token không hợp lệ hoặc đã hết hạn!"));
  }
};

// Middleware kiểm tra quyền hạn
export const verifyRole = (allowedRoles: ("admin" | "staff")[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(createError(401, "Chưa xác thực thông tin người dùng!"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        createError(403, "Từ chối truy cập! Bạn không có quyền thực hiện hành động này.")
      );
    }

    next();
  };
};

export default {
  verifyToken,
  verifyRole,
};