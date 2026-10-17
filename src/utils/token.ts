import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import createHttpError from "http-errors";
import type { AuthUser } from "../types/auth.type.js";

const secret = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
interface TokenPayload { userId: string; version: number; }
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
function verify(token: string, key: string): TokenPayload {
  try {
    const payload = jwt.verify(token, key, { algorithms: ["HS256"] });
    if (typeof payload === "string" || typeof payload["userId"] !== "string" ||
        !/^[0-9a-fA-F]{24}$/.test(payload["userId"]) ||
        !Number.isInteger(payload["version"])) throw createHttpError(401, "Token không hợp lệ");
    return { userId: payload["userId"], version: payload["version"] as number };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw createHttpError(401, "Token đã hết hạn");
    if (error instanceof jwt.JsonWebTokenError) throw createHttpError(401, "Token không hợp lệ");
    throw error;
  }
}
export function generateAccessToken(user: AuthUser): string {
  return jwt.sign({ userId: user.id, version: user.tokenVersion ?? 0 }, secret("JWT_SECRET"),
    { algorithm: "HS256", expiresIn: "15m", jwtid: randomUUID() });
}
export function generateRefreshToken(user: AuthUser): string {
  return jwt.sign({ userId: user.id, version: user.tokenVersion ?? 0 }, secret("JWT_REFRESH_SECRET"),
    { algorithm: "HS256", expiresIn: "7d", jwtid: randomUUID() });
}
export const verifyAccessToken = (token: string): TokenPayload => verify(token, secret("JWT_SECRET"));
export const verifyRefreshToken = (token: string): TokenPayload => verify(token, secret("JWT_REFRESH_SECRET"));
