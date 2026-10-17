import type { AuthUser } from "../types/auth.type.js";

type UserSource = Omit<AuthUser, "id" | "active"> & {
  _id: { toString(): string };
  active?: boolean;
};

export function toAuthUser(user: UserSource, active = user.active === true): AuthUser {
  return { id: user._id.toString(), email: user.email, firstName: user.firstName,
    lastName: user.lastName, role: user.role, active, tokenVersion: user.tokenVersion ?? 0 };
}

export function toPublicUser(user: AuthUser) {
  const { id, email, firstName, lastName, role } = user;
  return { id, email, firstName, lastName, role };
}

export function removeUserSecrets(value: Record<string, unknown>): Record<string, unknown> {
  for (const field of ["password", "refreshToken", "tokenVersion"]) delete value[field];
  return value;
}
