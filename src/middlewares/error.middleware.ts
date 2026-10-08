import type {
  Request,
  Response,
  NextFunction,
} from 'express';

import mongoose from 'mongoose';

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
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // Trùng tên Brand hoặc unique index khác
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

  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
    return;
  }

  console.error('API Error:', err);

  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
}