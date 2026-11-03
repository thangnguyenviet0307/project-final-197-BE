import { Types, type QueryFilter } from 'mongoose';
import type { IUser } from '../types/users.type.js';
import createHttpError from 'http-errors';
import { User } from '../models/users.model.js';
import type { AuthUser } from '../types/auth.type.js';
import { escapeRegex } from '../utils/search.js';
import { buildPagination } from '../utils/pagination.js';

export function orderAssigneeScope(actor: AuthUser): QueryFilter<IUser> {
  const role = actor.role;
  if (role !== 'super_admin' && role !== 'admin' && role !== 'staff') throw createHttpError(403, 'Không có quyền nhận đơn hàng.');
  const roles: IUser['role'][] = role === 'super_admin' ? ['admin', 'staff'] : role === 'admin' ? ['staff'] : [];
  return { active: true, $or: [{ _id: new Types.ObjectId(actor.id), role }, ...(roles.length ? [{ role: { $in: roles } }] : [])] };
}
export async function listOrderAssignees(actor: AuthUser, input: { page: number; limit: number; search?: string | undefined }) {
  if (!['super_admin', 'admin'].includes(actor.role)) throw createHttpError(403, 'Không có quyền phân công đơn hàng.');
  const search = input.search?.trim();
  const filter: QueryFilter<IUser> = { $and: [orderAssigneeScope(actor), ...(search ? [{ $or: ['firstName', 'lastName', 'email'].map(field => ({ [field]: { $regex: escapeRegex(search), $options: 'i' } })) }] : [])] };
  const [data, total] = await Promise.all([
    User.find(filter).select('_id firstName lastName email role').sort({ lastName: 1, firstName: 1, _id: 1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(),
    User.countDocuments(filter),
  ]);
  return { data, pagination: buildPagination(input.page, input.limit, total) };
}
