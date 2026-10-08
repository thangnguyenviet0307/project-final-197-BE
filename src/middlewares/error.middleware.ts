
import type {
  Request,
  Response,
  NextFunction,
} from 'express';

import mongoose from 'mongoose';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {

  // 1. Lỗi dữ liệu đầu vào từ Zod
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    });
    return;
  }

  // 2. Lỗi nghiệp vụ hoặc không tìm thấy dữ liệu
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // 3. Lỗi trùng unique index MongoDB
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 11000
  ) {
    res.status(409).json({
      success: false,
      message: 'Brand already exists',
    });
    return;
  }

  // 4. Lỗi Validation của Mongoose
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      success: false,
      message: 'Database validation failed',
      errors: Object.values(err.errors).map((error) => ({
        message: error.message,
      })),
    });
    return;
  }

  // 5. Lỗi Server không xác định
  console.error('API Error:', err);

  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
}
