import type { Request, Response, NextFunction } from "express";

import mongoose from "mongoose";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const hasDuplicateKeyError = (
  err: unknown,
): err is {
  code: number;
  keyPattern?: Record<string, unknown>;
} => {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === 11000
  );
};

const hasStatusCode = (
  err: unknown,
): err is { statusCode: number; message: string } => {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof err.statusCode === "number"
  );
};

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: err.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  if (hasDuplicateKeyError(err)) {
    const field =
      err.keyPattern && Object.keys(err.keyPattern).length > 0
        ? Object.keys(err.keyPattern)[0]
        : "field";

    res.status(409).json({
      success: false,
      message: `Duplicate value for ${field}`,
    });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      success: false,
      message: "Database validation failed",
      errors: Object.values(err.errors).map((error) => ({
        field: error.path,
        message: error.message,
      })),
    });
    return;
  }

  if (hasStatusCode(err)) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  if (err instanceof Error) {
    res.status(500).json({
      success: false,
      status: 500,
      message: err.message,
    });
    return;
  }

  next(err);
}

export const errorHandler = errorMiddleware;
