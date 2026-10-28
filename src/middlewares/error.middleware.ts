import { sendResponse } from "../helpers/response.helper.js";
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
  _next: NextFunction,
): void {
  if (res.headersSent) { _next(err); return; }
  if (err instanceof SyntaxError && hasStatusCode(err) && err.statusCode === 400) {
    sendResponse(res, 400, { success: false, message: "Invalid JSON request body", data: null });
    return;
  }
  if (err instanceof ZodError) {
    sendResponse(res, 400, {
      success: false,
      data: null,
      message: "Validation failed",
      errors: err.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
    return;
  }

  if (err instanceof mongoose.Error.VersionError) {
    sendResponse(res, 409, { success: false, message: "Data changed; please retry", data: null });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    sendResponse(res, 400, { success: false, message: "Invalid identifier or value", data: null });
    return;
  }
  if (hasDuplicateKeyError(err)) {
    const field =
      err.keyPattern && Object.keys(err.keyPattern).length > 0
        ? Object.keys(err.keyPattern)[0]
        : "field";

    sendResponse(res, 409, {
      success: false,
      data: null,
      message: `Duplicate value for ${field}`,
    });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    sendResponse(res, 400, {
      success: false,
      data: null,
      message: "Database validation failed",
      errors: Object.values(err.errors).map((error) => ({
        field: error.path,
        message: error.message,
      })),
    });
    return;
  }

  if (hasStatusCode(err)) {
    sendResponse(res, err.statusCode, {
      success: false,
      data: null,
      message: err.statusCode >= 500 ? "Internal server error" : err.message,
      ...("authCode" in err && typeof err.authCode === "string" && /^AUTH_[A-Z_]+$/.test(err.authCode) ? { code: err.authCode } : {}),
    });
    return;
  }

  if (err instanceof Error) {
    console.error("Unhandled API error", { name: err.name });
    sendResponse(res, 500, {
      success: false,
      data: null,
      status: 500,
      message: "Internal server error",
    });
    return;
  }

  sendResponse(res, 500, { message: "Internal server error" });
}

export const errorHandler = errorMiddleware;
