import type { Request, Response, RequestHandler } from "express";
import createHttpError from "http-errors";
import jwt from "jsonwebtoken";
export { frontendOrigins } from "../config/frontend-origins.js";
import { frontendOrigins } from "../config/frontend-origins.js";

export type LoginArea = "admin" | "storefront";
export function getLoginArea(req: Request): LoginArea | undefined {
  const area = req.get("X-Login-Area");
  if (area === undefined) return undefined;
  if (area !== "admin" && area !== "storefront") throw createHttpError(400, "Invalid login area");
  return area;
}
export function matchesLoginArea(role: string, area?: LoginArea): boolean {
  return area !== "storefront" && (role === "super_admin" || role === "admin" || role === "staff");
}
const cookieName = (area: LoginArea) => area === "storefront" ? "customerRefreshToken" : "adminRefreshToken";
const options = (area: LoginArea = "admin") => ({
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  // Vercel and Render are different sites; browser auth still requires a trusted Origin.
  sameSite: process.env["NODE_ENV"] === "production" ? "none" as const : "strict" as const,
  path: area === "storefront" ? "/api/v1/customer-auth" : "/api/v1/auth",
});
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
      if (req.get("Origin") && req.path === "/refresh") throw createHttpError(403, "Browser refresh requires cookie transport", { authCode: "AUTH_TRANSPORT_REQUIRED" });
      return next();
    }
    const origin = req.get("Origin");
    if (!origin || !frontendOrigins().includes(origin)) throw createHttpError(403, "Untrusted authentication origin", { authCode: "AUTH_ORIGIN_REJECTED" });
    if (!area) throw createHttpError(400, "Browser authentication requires a login area");
    if (req.path === "/refresh") {
      const name = cookieName(area ?? "admin");
      const raw = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
      if (!raw) throw createHttpError(401, "Your session has expired. Please sign in again.", { authCode: "AUTH_REFRESH_COOKIE_MISSING" });
      try { req.body = { refreshToken: decodeURIComponent(raw) }; }
      catch { throw createHttpError(400, "Invalid authentication cookie", { authCode: "AUTH_REFRESH_COOKIE_INVALID" }); }
    }
    next();
  } catch (error) { next(error); }
};
