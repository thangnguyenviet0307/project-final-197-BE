import type { Response } from "express";
interface ResponsePayload {
  data?: unknown;
  message?: string;
  success?: boolean;
  [key: string]: unknown;
}
export function sendResponse(res: Response, statusCode: number, payload: ResponsePayload): Response {
  return res.status(statusCode).json({
    success: statusCode < 400, statusCode,
    message: statusCode < 400 ? "Success" : "Request failed", data: null, ...payload,
  });
}
