import type { CookieOptions, RequestHandler, Request, Response } from "express";
import createHttpError from "http-errors";
import { frontendOrigins } from "../config/frontend-origins.js";
import type { TokenPair } from "../types/auth.type.js";

import { loginAreaSchema } from "../validations/auth.validation.js";

function cookieName(req?: Request): string {
  const area = req?.get("X-Login-Area");
  return area === "admin" ? "adminRefreshToken" : area === "storefront" ? "customerRefreshToken" : "refreshToken";
}
const cookieOptions = (): CookieOptions => ({
  httpOnly: true, secure: process.env["NODE_ENV"] === "production",
  sameSite: "strict", path: "/api/v1/auth",
});

export const browserAuth: RequestHandler = (req, _res, next) => {
  if (req.get("X-Auth-Transport") !== "cookie") return next();
  loginAreaSchema.parse(req.get("X-Login-Area"));
  const origin = req.get("Origin");
  if (!origin || !frontendOrigins().includes(origin)) {
    return next(createHttpError(403, "Untrusted browser authentication origin"));
  }
  if (req.path === "/refresh") {
    const entry = req.headers.cookie?.split(";").map(value => value.trim())
      .find(value => value.startsWith(cookieName(req) + "="));
    if (!entry) return next(createHttpError(401, "Your session has expired. Please sign in again."));
    try {
      req.body = { refreshToken: decodeURIComponent(entry.slice(cookieName(req).length + 1)) };
    } catch { return next(createHttpError(401, "Invalid refresh cookie")); }
  }
  next();
};

export function browserTokenResponse<T extends TokenPair>(req: Request, res: Response, result: T) {
  if (req.get("X-Auth-Transport") !== "cookie") return result;
  res.cookie(cookieName(req), result.refreshToken, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
  const { refreshToken: _refreshToken, ...publicResult } = result;
  return publicResult;
}

export function clearRefreshCookie(res: Response, req?: Request): void {
  res.clearCookie(cookieName(req), cookieOptions());
}
