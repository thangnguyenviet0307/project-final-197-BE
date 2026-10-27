import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import createHttpError from "http-errors";
import type { JwtPayload, TokenPair } from "../types/auth.type.js";

const secret = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
type TokenPayload = JwtPayload;
type TokenSubject = { id: string; tokenVersion?: number; accountType?: "user" | "customer" };
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
function verify(token: string, key: string): TokenPayload {
  try {
    const payload = jwt.verify(token, key, { algorithms: ["HS256"] });
    if (typeof payload === "string" || typeof payload["userId"] !== "string" ||
        !/^[0-9a-fA-F]{24}$/.test(payload["userId"]) ||
        !Number.isInteger(payload["version"])) throw createHttpError(401, "Token không hợp lệ");
    if (payload["accountType"] !== undefined && payload["accountType"] !== "user" && payload["accountType"] !== "customer") throw createHttpError(401, "Invalid account type");
    return { userId: payload["userId"], version: payload["version"] as number, accountType: payload["accountType"] === "customer" ? "customer" : "user" };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw createHttpError(401, "Token đã hết hạn");
    if (error instanceof jwt.JsonWebTokenError) throw createHttpError(401, "Token không hợp lệ");
    throw error;
  }
}
function signToken(user: TokenSubject, secretName: "JWT_SECRET" | "JWT_REFRESH_SECRET", expiresIn: "15m" | "7d"): string {
  return jwt.sign({ userId: user.id, version: user.tokenVersion ?? 0, accountType: user.accountType ?? "user" }, secret(secretName),
    { algorithm: "HS256", expiresIn, jwtid: randomUUID() });
}
export function generateAccessToken(user: TokenSubject): string {
  return signToken(user, "JWT_SECRET", "15m");
}
export function generateRefreshToken(user: TokenSubject): string {
  return signToken(user, "JWT_REFRESH_SECRET", "7d");
}
export function generateTokenPair(user: TokenSubject): TokenPair {
  return { accessToken: generateAccessToken(user), refreshToken: generateRefreshToken(user) };
}
export const verifyAccessToken = (token: string): TokenPayload => verify(token, secret("JWT_SECRET"));
export const verifyRefreshToken = (token: string): TokenPayload => verify(token, secret("JWT_REFRESH_SECRET"));
