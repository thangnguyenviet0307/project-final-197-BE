
import type {
  Request,
  Response,
  NextFunction,
} from "express";

import mongoose from "mongoose";
import { ZodError } from "zod";

// ===================================
// Brands API - ApiError
// ===================================
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ===================================
// Brands API - Error Middleware
// ===================================
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {

  // 1. Lỗi dữ liệu đầu vào từ Zod
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: err.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    });
    return;
  }

  // 2. Lỗi nghiệp vụ
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // 3. Lỗi trùng dữ liệu MongoDB
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === 11000
  ) {
    res.status(409).json({
      success: false,
      message: "Brand already exists",
    });
    return;
  }

  // 4. Lỗi Mongoose Validation
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      success: false,
      message: "Database validation failed",
      errors: Object.values(err.errors).map((error) => ({
        message: error.message,
      })),
    });
    return;
  }

  // 5. Chuyển lỗi chưa nhận diện cho handler chung
  next(err);
}

// ===================================
// Global Error Handler của team
// Giữ nguyên logic hiện tại
// ===================================
export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message,
    stack: process.env['NODE_ENV'] === "development" ? err.stack : undefined,
  });
};
