import type { Request, RequestHandler } from "express";
import { sendResponse } from "../helpers/response.helper.js";

// Per-process guard. Multiple public API instances need a shared gateway limiter.
export function createAuthRateLimit(
  limit = 30,
  windowMs = 15 * 60 * 1000,
  message = "Too many authentication requests; retry later",
  keyForRequest: (req: Request) => string = req => req.ip ?? req.socket.remoteAddress ?? "unknown",
): RequestHandler {
  const attempts = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = keyForRequest(req);
    for (const [ip, entry] of attempts)
      if (entry.expires <= now) attempts.delete(ip);
    let entry = attempts.get(key);
    // Bound memory even under traffic from many different addresses.
    if (!entry && attempts.size >= 10000) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      sendResponse(res, 429, { success: false, message, data: null });
      return;
    }
    if (!entry) {
      entry = { count: 0, expires: now + windowMs };
      attempts.set(key, entry);
    }
    if (entry.count >= limit) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((entry.expires - now) / 1000)),
      );
      sendResponse(res, 429, { success: false, message, data: null });
      return;
    }
    entry.count++;
    next();
  };
}
