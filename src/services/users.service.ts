import { OPEN_ORDER_STATUSES } from "../types/orders.type.js";
import argon2 from "argon2";
import createHttpError from "http-errors";
import { User } from "../models/users.model.js";
import { accentInsensitiveRegex } from "../utils/search.js";
import { buildPagination } from "../utils/pagination.js";
import type { CreateUserInput, UpdateUserInput, GetUsersQuery, IUser } from "../types/users.type.js";
import type { ClientSession, QueryFilter } from "mongoose";
import { Order } from "../models/orders.model.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { sessionRevocationUpdate } from "../utils/session.js";
import type { AuthUser } from "../types/auth.type.js";
import { verifyPassword } from "../utils/password.js";
import { hasPermission } from "../config/rolePermissions.js";
import { Permission } from "../types/permissions.type.js";

type UserActor = Pick<AuthUser, 'id' | 'role'>;
function requireUserManager(actor: UserActor) {
  if (actor.role !== 'super_admin' && actor.role !== 'admin') throw createHttpError(403, 'Cannot manage user accounts');
}
function manageableRoles(actor: UserActor): ('admin' | 'staff')[] {
  requireUserManager(actor);
  return hasPermission(actor.role, Permission.UserManageAdmins) ? ['admin', 'staff'] : ['staff'];
}

async function protectLastAdmin(id: string, session: ClientSession, roles: readonly string[]) {
  const user = await User.findById(id).session(session);
  if (!user) throw createHttpError(404, "User not found");
  if (!roles.includes(user.role)) throw createHttpError(403, 'Transfer ownership before modifying the Super Admin');
  if (user.role === "admin" && (user.active === true || user.active === undefined)) {
    const other = await User.exists({ _id: { $ne: id }, role: { $in: ['super_admin', 'admin'] },
      $or: [{ active: true }, { active: { $exists: false } }] }).session(session);
    if (!other) throw createHttpError(409, "Cannot remove the last active administrator");
  }
}

export const UserService = {
  async revokeSessions(id: string, actor: UserActor) {
    const roles = manageableRoles(actor);
    const user = await User.findOneAndUpdate({ _id: id, role: { $in: roles } }, sessionRevocationUpdate(), { returnDocument: 'after' });
    if (!user) throw createHttpError(404, 'User not found or protected');
  },
  async transferOwnership(actor: UserActor, targetUserId: string, currentPassword: string) {
    if (actor.role !== 'super_admin' || actor.id === targetUserId) throw createHttpError(403, 'Only Super Admin can transfer ownership to another account');
    const owner = await User.findOne({ _id: actor.id, role: 'super_admin', active: true }).select('+password');
    if (!owner || !(await verifyPassword(owner.password, currentPassword)).valid) throw createHttpError(400, 'Current password is incorrect');
    return withRelationsTransaction(async session => {
      const source = await User.findOneAndUpdate({ _id: actor.id, role: 'super_admin', active: true, password: owner.password },
        { $set: { role: 'admin', ...sessionRevocationUpdate().$set }, $inc: { tokenVersion: 1 } }, { session, returnDocument: 'after' });
      if (!source) throw createHttpError(409, 'Ownership changed; sign in again');
      const target = await User.findOneAndUpdate({ _id: targetUserId, role: { $in: ['admin', 'staff'] }, active: true, mustChangePassword: { $ne: true } },
        { $set: { role: 'super_admin', ...sessionRevocationUpdate().$set }, $inc: { tokenVersion: 1 } }, { session, returnDocument: 'after', runValidators: true });
      if (!target) throw createHttpError(409, 'Choose an active account that has changed its temporary password');
    });
  },
  async getAllUsers({ page, limit, search, role, active, sortBy, sortOrder }: GetUsersQuery) {
    const searchTerms = search?.trim().split(/\s+/).filter(Boolean) ?? [];
    const searchFilter = searchTerms.length
      ? {
          $and: searchTerms.map((term) => ({
            $or: ["firstName", "lastName", "email"].map((field) => ({
              [field]: accentInsensitiveRegex(term),
            })),
          })),
        }
      : {};
    const filter: QueryFilter<IUser> = { ...searchFilter, role: role ?? { $in: ["super_admin", "admin", "staff"] }, ...(active === true ? { $or: [{ active: true }, { active: { $exists: false } }] } : active === false ? { active: false } : {}) };
    const direction = sortOrder === "desc" ? -1 : 1;
    const rows = sortBy === "username" ? User.aggregate([
      { $match: filter },
      { $set: { sortUsername: { $toLower: { $arrayElemAt: [{ $split: ["$email", "@"] }, 0] } } } },
      { $sort: { sortUsername: direction, _id: direction } },
      { $skip: (page - 1) * limit }, { $limit: limit },
      { $project: { _id: 1, firstName: 1, lastName: 1, email: 1, role: 1, active: { $ifNull: ["$active", true] }, mustChangePassword: 1,
        personalEmail: 1, phone: 1, avatar: 1, location: 1, bio: 1, createdAt: 1, updatedAt: 1 } },
    ]) : User.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
    const [data, total] = await Promise.all([
      rows,
      User.countDocuments(filter),
    ]);
    return { data, pagination: buildPagination(page, limit, total) };
  },
  async getUserById(id: string) {
    const user = await User.findOne({ _id: id, role: { $in: ["super_admin", "admin", "staff"] } });
    if (!user) throw createHttpError(404, "User not found");
    return user;
  },
  async createUser(input: CreateUserInput, actor: UserActor) {
    const roles = manageableRoles(actor);
    if (!roles.includes(input.role)) throw createHttpError(403, 'Only Super Admin can create an administrator');
    if (await User.exists({ email: input.email, role: { $in: ["super_admin", "admin", "staff"] } })) throw createHttpError(409, "Email already exists");
    return User.create({ ...input, mustChangePassword: true, password: await argon2.hash(input.password) });
  },
  async updateUser(id: string, input: UpdateUserInput, actor: UserActor) {
    const roles = manageableRoles(actor);
    if (input.role !== undefined && (actor.role !== 'super_admin' || !roles.includes(input.role))) throw createHttpError(403, 'Only Super Admin can change roles');
    const { password, ...fields } = input;
    if (fields.email && await User.exists({ email: fields.email, role: { $in: ["super_admin", "admin", "staff"] }, _id: { $ne: id } })) {
      throw createHttpError(409, "Email already exists");
    }
    const shouldRevokeSessions = Boolean(password || fields.active === false || fields.role);
    const revocation = shouldRevokeSessions ? sessionRevocationUpdate() : undefined;
    const update = {
      $set: { ...fields, ...(password ? { password: await argon2.hash(password), mustChangePassword: true } : {}),
        ...revocation?.$set },
      ...(revocation ? { $inc: revocation.$inc } : {}),
    };
    const saveUser = async (session?: ClientSession) => {
      const user = await User.findOneAndUpdate({ _id: id, role: { $in: roles } }, update, {
        returnDocument: 'after', runValidators: true, ...(session ? { session } : {}),
      });
      if (!user) throw createHttpError(404, "User not found");
      return user;
    };
    if (fields.active !== undefined || fields.role !== undefined) {
      return withRelationsTransaction(async (session) => {
        if (fields.active === false || fields.role === "staff") await protectLastAdmin(id, session, roles);
        if (fields.active === false && await Order.exists({ userId: id, orderStatus: { $in: OPEN_ORDER_STATUSES } }).session(session)) {
          throw createHttpError(409, "Reassign open orders before disabling this user");
        }
        return saveUser(session);
      });
    }
    return saveUser();
  },
  async deleteUser(id: string, actor: UserActor) {
    const roles = manageableRoles(actor);
    return withRelationsTransaction(async (session) => {
      await protectLastAdmin(id, session, roles);
      if (await Order.exists({ userId: id }).session(session)) throw createHttpError(409, "Cannot delete a user referenced by orders");
      const deleted = await User.findOneAndDelete({ _id: id, role: { $in: roles } }, { session });
      if (!deleted) throw createHttpError(404, "User not found");
    });
  },
};
