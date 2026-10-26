import type { Request, Response, RequestHandler } from "express";
import createHttpError from "http-errors";
import jwt from "jsonwebtoken";

export function frontendOrigins(): string[] {
  return (process.env["FRONTEND_ORIGINS"] ?? (process.env["NODE_ENV"] === "production" ? "" : "http://localhost:5173,http://127.0.0.1:5173")).split(",").map(value => value.trim()).filter(Boolean);
}
const name = "admin_refresh";
const options = () => ({ httpOnly: true, secure: process.env["NODE_ENV"] === "production", sameSite: "strict" as const, path: "/api/v1/auth" });
export function clearRefreshCookie(res: Response) { res.clearCookie(name, options()); res.clearCookie("refreshToken", options()); }
export function authResponse(req: Request, res: Response, result: { accessToken: string; refreshToken: string; user?: unknown }) {
  res.setHeader("Cache-Control", "no-store");
  if (req.get("X-Auth-Transport") !== "cookie") return result;
  const decoded = jwt.decode(result.refreshToken);
  const expires = decoded && typeof decoded === "object" && decoded.exp ? new Date(decoded.exp * 1000) : undefined;
  res.cookie(name, result.refreshToken, { ...options(), ...(expires ? { expires } : {}) });
  const { refreshToken: _secret, ...publicResult } = result;
  return publicResult;
}
// Custom header forces a CORS preflight; exact Origin allowlist and SameSite protect cookie refresh from CSRF.
export const cookieAuthTransport: RequestHandler = (req, _res, next) => {
  if (req.get("X-Auth-Transport") !== "cookie") {
    if (req.get("Origin") && req.path === "/refresh") return next(createHttpError(403, "Browser refresh requires cookie transport"));
    return next();
  }
  const origin = req.get("Origin");
  if (!origin || !frontendOrigins().includes(origin)) return next(createHttpError(403, "Untrusted authentication origin"));
  if (req.path === "/refresh") {
    const cookieHeader = req.headers.cookie?.replace(/(^|;\s*)refreshToken=/g, "$1admin_refresh="); const raw = cookieHeader?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!raw) return next(createHttpError(401, "Your session has expired. Please sign in again.")); try { req.body = { refreshToken: raw ? decodeURIComponent(raw) : "" }; }
    catch { return next(createHttpError(400, "Invalid authentication cookie")); }
  }
  next();
};
