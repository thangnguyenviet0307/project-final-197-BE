import argon2 from 'argon2';
import { User } from '../models/user.model.js';
import { buildPagination } from '../utils/pagination.js';
import type { IUser } from '../types/user.type.js';
import type {
  CreateUserInput,
  GetUsersQuery,
  UpdateUserInput,
} from '../validations/user.validation.js';

export async function getUsers({ page, limit, search, role, active }: GetUsersQuery) {
  const filter: Record<string, unknown> = {};
  if (search) {
    filter['$or'] = [
      { email: new RegExp(search, 'i') },
      { firstName: new RegExp(search, 'i') },
      { lastName: new RegExp(search, 'i') },
    ];
  }
  if (role) filter['role'] = role;
  if (active !== undefined) filter['active'] = active;

  const [data, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-password -refreshToken -__v'),
    User.countDocuments(filter),
  ]);

  return { data, pagination: buildPagination(page, limit, total) };
}

export async function getUserById(id: string) {
  const user = await User.findById(id).select('-password -refreshToken -__v');
  if (!user) throw new Error('User not found');
  return user;
}

export async function createUser(input: CreateUserInput): Promise<IUser> {
  const existing = await User.findOne({ email: input.email });
  if (existing) throw new Error('Email already exists');

  const hashedPassword = await argon2.hash(input.password);

  return User.create({
    ...input,
    password: hashedPassword,
  });
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<IUser | null> {
  if (input.email) {
    const existing = await User.findOne({ email: input.email, _id: { $ne: id } });
    if (existing) throw new Error('Email already exists');
  }

  const updateData: Record<string, unknown> = { ...input };
  if (input.password) {
    updateData['password'] = await argon2.hash(input.password);
  }

  const user = await User.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
    .select('-password -refreshToken -__v');
  return user;
}

export async function deleteUser(id: string) {
  const user = await User.findByIdAndDelete(id);
  if (!user) throw new Error('User not found');
  return user;
}