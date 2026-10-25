import type { IPaginationQuery } from "./common.types.js";
export interface IUser {
  personalEmail?: string;
  phone?: string;
  location?: string;
  bio?: string;
  avatar?: string;

  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'staff';
  active: boolean;
  tokenVersion: number;
  mustChangePassword?: boolean;
  refreshToken?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: "admin" | "staff";
  active: boolean;
}
export interface UpdateUserInput {
  email?: string | undefined;
  password?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  role?: "admin" | "staff" | undefined;
  active?: boolean | undefined;
}
export interface GetUsersQuery extends IPaginationQuery {
  search?: string | undefined;
}
