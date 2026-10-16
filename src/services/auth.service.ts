import argon2 from 'argon2';
import createHttpError from 'http-errors';
import { User } from '../models/user.model.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../middlewares/auth.middleware.js';
import type { AuthUser } from '../types/auth.type.js';
import type { CreateUserInput } from '../validations/user.validation.js';

export async function login(email: string, password: string) {
  const user = await User.findOne({ email }).select('+password');
  if (!user || !user.active) {
    throw createHttpError(401, 'Email hoặc mật khẩu không chính xác');
  }

  const valid = await argon2.verify(user.password, password);
  if (!valid) {
    throw createHttpError(401, 'Email hoặc mật khẩu không chính xác');
  }

  const authUser: AuthUser = {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    active: user.active,
  };

  const accessToken = generateAccessToken(authUser);
  const refreshToken = generateRefreshToken(authUser);

  user.refreshToken = refreshToken;
  await user.save();

  return {
    user: {
      id: authUser.id,
      email: authUser.email,
      firstName: authUser.firstName,
      lastName: authUser.lastName,
      role: authUser.role,
    },
    accessToken,
    refreshToken,
  };
}

export async function bootstrapAdmin(input: CreateUserInput) {
  const userCount = await User.countDocuments();
  if (userCount > 0) {
    throw createHttpError(403, 'Đã có người dùng trong hệ thống, không thể bootstrap');
  }

  const hashedPassword = await argon2.hash(input.password);
  const user = await User.create({
    ...input,
    password: hashedPassword,
    role: 'admin',
  });

  const authUser: AuthUser = {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    active: user.active,
  };

  const accessToken = generateAccessToken(authUser);
  const refreshToken = generateRefreshToken(authUser);
  user.refreshToken = refreshToken;
  await user.save();

  return {
    user: {
      id: authUser.id,
      email: authUser.email,
      firstName: authUser.firstName,
      lastName: authUser.lastName,
      role: authUser.role,
    },
    accessToken,
    refreshToken,
  };
}

export async function logout(userId: string) {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
}

export async function refresh(refreshToken: string) {
  const decoded = verifyRefreshToken(refreshToken);
  const user = await User.findById(decoded.userId).select('+refreshToken');
  if (!user || !user.active || user.refreshToken !== refreshToken) {
    throw createHttpError(401, 'Refresh token không hợp lệ');
  }

  const authUser: AuthUser = {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    active: user.active,
  };

  const newAccessToken = generateAccessToken(authUser);
  const newRefreshToken = generateRefreshToken(authUser);
  user.refreshToken = newRefreshToken;
  await user.save();

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}