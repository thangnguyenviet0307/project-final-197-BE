export interface AuthUser {
  personalEmail?: string;
  phone?: string;
  location?: string;
  bio?: string;
  avatar?: string;

  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  active: boolean;
  mustChangePassword?: boolean;
  tokenVersion?: number;
}

export interface JwtPayload {
  userId: string;
  version: number;
  accountType: "user" | "customer";
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginInput {
  email: string;
  password: string;
}
export interface RegisterCustomerInput extends LoginInput {
  firstName: string;
  lastName: string;
}

export interface BootstrapInput extends LoginInput {
  firstName: string;
  lastName: string;
  active: true;
}
export interface RefreshInput {
  refreshToken: string;
}
