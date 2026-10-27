import type { Request, Response, RequestHandler } from "express";
import createHttpError from "http-errors";
import jwt from "jsonwebtoken";

export type LoginArea = "admin" | "storefront";
export function getLoginArea(req: Request): LoginArea | undefined {
  const area = req.get("X-Login-Area");
  if (area === undefined) return undefined;
  if (area !== "admin" && area !== "storefront") throw createHttpError(400, "Invalid login area");
  return area;
}
export function matchesLoginArea(role: string, area?: LoginArea): boolean {
  return area !== "storefront" && (role === "admin" || role === "staff");
}
export function frontendOrigins(): string[] {
  return (process.env["FRONTEND_ORIGINS"] ?? (process.env["NODE_ENV"] === "production" ? "" : "http://localhost:5173,http://127.0.0.1:5173")).split(",").map(value => value.trim()).filter(Boolean);
}
const cookieName = (area: LoginArea) => area === "storefront" ? "customerRefreshToken" : "adminRefreshToken";
const options = (area: LoginArea = "admin") => ({ httpOnly: true, secure: process.env["NODE_ENV"] === "production", sameSite: "strict" as const, path: area === "storefront" ? "/api/v1/customer-auth" : "/api/v1/auth" });
export function clearRefreshCookie(res: Response, area: LoginArea = "admin") {
  res.clearCookie(cookieName(area), options(area));
}
export function authResponse(req: Request, res: Response, result: { accessToken: string; refreshToken: string; user?: unknown }) {
  res.setHeader("Cache-Control", "no-store");
  if (req.get("X-Auth-Transport") !== "cookie") return result;
  const decoded = jwt.decode(result.refreshToken);
  const expires = decoded && typeof decoded === "object" && decoded.exp ? new Date(decoded.exp * 1000) : undefined;
  res.cookie(cookieName(getLoginArea(req) ?? "admin"), result.refreshToken, { ...options(getLoginArea(req) ?? "admin"), ...(expires ? { expires } : {}) });
  const { refreshToken: _secret, ...publicResult } = result;
  return publicResult;
}
// Read only the selected area's cookie; never fall back to the other account or legacy shared cookies.
export const cookieAuthTransport: RequestHandler = (req, _res, next) => {
  try {
    const area = getLoginArea(req);
    if (req.get("X-Auth-Transport") !== "cookie") {
      if (req.get("Origin") && req.path === "/refresh") throw createHttpError(403, "Browser refresh requires cookie transport");
      return next();
    }
    const origin = req.get("Origin");
    if (!origin || !frontendOrigins().includes(origin)) throw createHttpError(403, "Untrusted authentication origin");
    if (!area) throw createHttpError(400, "Browser authentication requires a login area");
    if (req.path === "/refresh") {
      const name = cookieName(area ?? "admin");
      const raw = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
      if (!raw) throw createHttpError(401, "Your session has expired. Please sign in again.");
      try { req.body = { refreshToken: decodeURIComponent(raw) }; }
      catch { throw createHttpError(400, "Invalid authentication cookie"); }
    }
    next();
  } catch (error) { next(error); }
};
