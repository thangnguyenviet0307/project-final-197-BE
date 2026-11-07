import { OPEN_ORDER_STATUSES } from '../../types/orders/orders.type.js';
import argon2 from 'argon2';
import {
  newSecret,
  newTemporaryPassword,
  TEMPORARY_PASSWORD_MS,
} from '../../utils/auth/account-security.js';
import { emailService } from '../auth/email.service.js';
import { createEmailSchema } from '../../validations/shared/common.validation.js';
import createHttpError from 'http-errors';
import { User } from '../../models/users/users.model.js';
import { accentInsensitiveRegex } from '../../utils/shared/search.js';
import { buildPagination } from '../../utils/shared/pagination.js';
import type {
  CreateUserInput,
  UpdateUserInput,
  GetUsersQuery,
  IUser,
} from '../../types/users/users.type.js';
import type { ClientSession, QueryFilter } from 'mongoose';
import { Order } from '../../models/orders/orders.model.js';
import { withRelationsTransaction } from '../../utils/shared/relations-transaction.js';
import { sessionRevocationUpdate } from '../../utils/auth/session.js';
import type { AuthUser } from '../../types/auth/auth.type.js';
import { verifyPassword } from '../../utils/auth/password.js';
import { hasPermission } from '../../config/rolePermissions.js';
import { Permission } from '../../types/shared/permissions.type.js';

type UserActor = Pick<AuthUser, 'id' | 'role'>;
function requireUserManager(actor: UserActor) {
  if (actor.role !== 'super_admin' && actor.role !== 'admin')
    throw createHttpError(403, 'Cannot manage user accounts');
}
function manageableRoles(actor: UserActor): ('admin' | 'staff')[] {
  requireUserManager(actor);
  return hasPermission(actor.role, Permission.UserManageAdmins)
    ? ['admin', 'staff']
    : ['staff'];
}

async function protectLastAdmin(
  id: string,
  session: ClientSession,
  roles: readonly string[]
) {
  const user = await User.findById(id).session(session);
  if (!user) throw createHttpError(404, 'User not found');
  if (!roles.includes(user.role))
    throw createHttpError(
      403,
      'Transfer ownership before modifying the Super Admin'
    );
  if (
    user.role === 'admin' &&
    (user.active === true || user.active === undefined)
  ) {
    const other = await User.exists({
      _id: { $ne: id },
      role: { $in: ['super_admin', 'admin'] },
      $or: [{ active: true }, { active: { $exists: false } }],
    }).session(session);
    if (!other)
      throw createHttpError(409, 'Cannot remove the last active administrator');
  }
}

export const UserService = {
  async reissueInitialPassword(id: string, password: string, actor: UserActor) {
    const roles = manageableRoles(actor);
    const hash = await argon2.hash(password);
    const revocation = sessionRevocationUpdate();
    const updated = await User.findOneAndUpdate(
      {
        _id: id,
        role: { $in: roles },
        active: true,
        onboardingRequired: true,
        personalEmailVerified: { $ne: true },
      },
      {
        $set: {
          ...revocation.$set,
          password: hash,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: new Date(
            Date.now() + TEMPORARY_PASSWORD_MS
          ),
        },
        $inc: revocation.$inc,
        $unset: { pendingPassword: 1, emailVerification: 1 },
      },
      { runValidators: true }
    );
    if (!updated)
      throw createHttpError(
        409,
        'Only incomplete accounts without a verified email can be reissued initial credentials'
      );
  },
  async revokeSessions(id: string, actor: UserActor) {
    const roles = manageableRoles(actor);
    const user = await User.findOneAndUpdate(
      { _id: id, role: { $in: roles } },
      sessionRevocationUpdate(),
      { returnDocument: 'after' }
    );
    if (!user) throw createHttpError(404, 'User not found or protected');
  },
  async transferOwnership(
    actor: UserActor,
    targetUserId: string,
    currentPassword: string
  ) {
    if (actor.role !== 'super_admin' || actor.id === targetUserId)
      throw createHttpError(
        403,
        'Only Super Admin can transfer ownership to another account'
      );
    const owner = await User.findOne({
      _id: actor.id,
      role: 'super_admin',
      active: true,
    }).select('+password');
    if (
      !owner ||
      !(await verifyPassword(owner.password, currentPassword)).valid
    )
      throw createHttpError(400, 'Current password is incorrect');
    return withRelationsTransaction(async (session) => {
      const source = await User.findOneAndUpdate(
        {
          _id: actor.id,
          role: 'super_admin',
          active: true,
          password: owner.password,
        },
        {
          $set: { role: 'admin', ...sessionRevocationUpdate().$set },
          $inc: { tokenVersion: 1 },
        },
        { session, returnDocument: 'after' }
      );
      if (!source)
        throw createHttpError(409, 'Ownership changed; sign in again');
      const target = await User.findOneAndUpdate(
        {
          _id: targetUserId,
          role: { $in: ['admin', 'staff'] },
          active: true,
          mustChangePassword: { $ne: true },
        },
        {
          $set: { role: 'super_admin', ...sessionRevocationUpdate().$set },
          $inc: { tokenVersion: 1 },
        },
        { session, returnDocument: 'after', runValidators: true }
      );
      if (!target)
        throw createHttpError(
          409,
          'Choose an active account that has changed its temporary password'
        );
    });
  },
  async getAllUsers({
    page,
    limit,
    search,
    role,
    active,
    sortBy,
    sortOrder,
  }: GetUsersQuery) {
    const searchTerms = search?.trim().split(/\s+/).filter(Boolean) ?? [];
    const searchFilter = searchTerms.length
      ? {
          $and: searchTerms.map((term) => ({
            $or: ['firstName', 'lastName', 'email'].map((field) => ({
              [field]: accentInsensitiveRegex(term),
            })),
          })),
        }
      : {};
    const filter: QueryFilter<IUser> = {
      ...searchFilter,
      role: role ?? { $in: ['super_admin', 'admin', 'staff'] },
      ...(active === true
        ? { $or: [{ active: true }, { active: { $exists: false } }] }
        : active === false
          ? { active: false }
          : {}),
    };
    const direction = sortOrder === 'desc' ? -1 : 1;
    const rows =
      sortBy === 'username'
        ? User.aggregate([
            { $match: filter },
            {
              $set: {
                sortUsername: {
                  $toLower: { $arrayElemAt: [{ $split: ['$email', '@'] }, 0] },
                },
              },
            },
            { $sort: { sortUsername: direction, _id: direction } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                email: 1,
                role: 1,
                active: { $ifNull: ['$active', true] },
                mustChangePassword: 1,
                onboardingRequired: 1,
                personalEmailVerified: 1,
                personalEmail: 1,
                phone: 1,
                avatar: 1,
                location: 1,
                bio: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ])
        : User.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit);
    const [data, total] = await Promise.all([
      rows,
      User.countDocuments(filter),
    ]);
    return { data, pagination: buildPagination(page, limit, total) };
  },
  async resetPassword(id: string, actor: UserActor) {
    const roles = manageableRoles(actor);
    const target = await User.findOne({
      _id: id,
      role: { $in: roles },
      active: true,
    }).select('+password +tokenVersion +pendingPassword');
    if (!target) throw createHttpError(404, 'User not found or protected');
    if (
      !target.personalEmailVerified ||
      !createEmailSchema().safeParse(target.personalEmail).success
    )
      throw createHttpError(
        409,
        'Personal email must be verified before resetting the password'
      );
    const password = newTemporaryPassword();
    const pending = {
      id: newSecret(),
      hash: await argon2.hash(password),
      expiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_MS),
    };
    const identity = {
      _id: id,
      active: true,
      role: { $in: roles },
      password: target.password,
      tokenVersion: target.tokenVersion ?? 0,
      personalEmail: target.personalEmail!,
      personalEmailVerified: true,
    };
    const reserved = await User.findOneAndUpdate(
      {
        ...identity,
        $or: [
          { pendingPassword: { $exists: false } },
          { 'pendingPassword.expiresAt': { $lte: new Date() } },
        ],
      },
      { $set: { pendingPassword: pending } }
    );
    if (!reserved)
      throw createHttpError(
        409,
        'Account changed or a reset is already pending'
      );
    try {
      await emailService.send(
        target.personalEmail!,
        'Mật khẩu tạm thời',
        `Mật khẩu tạm thời của bạn: ${password}\nBạn có 30 phút từ khi mật khẩu được kích hoạt để đăng nhập và đổi mật khẩu. Không chia sẻ mật khẩu này.`
      );
      const revocation = sessionRevocationUpdate();
      const activated = await User.findOneAndUpdate(
        {
          ...identity,
          'pendingPassword.id': pending.id,
          'pendingPassword.expiresAt': { $gt: new Date() },
        },
        {
          $set: {
            ...revocation.$set,
            password: pending.hash,
            mustChangePassword: true,
            temporaryPasswordExpiresAt: new Date(
              Date.now() + TEMPORARY_PASSWORD_MS
            ),
          },
          $inc: revocation.$inc,
          $unset: { pendingPassword: 1, emailVerification: 1 },
        },
        { runValidators: true }
      );
      if (!activated)
        throw createHttpError(
          409,
          'Account changed; please request another reset'
        );
    } finally {
      await User.updateOne(
        { _id: id, 'pendingPassword.id': pending.id },
        { $unset: { pendingPassword: 1 } }
      );
    }
  },
  async getUserById(id: string) {
    const user = await User.findOne({
      _id: id,
      role: { $in: ['super_admin', 'admin', 'staff'] },
    });
    if (!user) throw createHttpError(404, 'User not found');
    return user;
  },
  async createUser(input: CreateUserInput, actor: UserActor) {
    const roles = manageableRoles(actor);
    if (!roles.includes(input.role))
      throw createHttpError(
        403,
        'Only Super Admin can create an administrator'
      );
    if (
      await User.exists({
        email: input.email,
        role: { $in: ['super_admin', 'admin', 'staff'] },
      })
    )
      throw createHttpError(409, 'Email already exists');
    const passwordHash = await argon2.hash(input.password);
    return User.create({
      ...input,
      mustChangePassword: true,
      onboardingRequired: true,
      personalEmailVerified: false,
      temporaryPasswordExpiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_MS),
      password: passwordHash,
    });
  },
  async updateUser(id: string, input: UpdateUserInput, actor: UserActor) {
    const roles = manageableRoles(actor);
    if (
      input.role !== undefined &&
      (actor.role !== 'super_admin' || !roles.includes(input.role))
    )
      throw createHttpError(403, 'Only Super Admin can change roles');
    if (input.password !== undefined)
      throw createHttpError(400, 'Use the dedicated password reset endpoint');
    const { password: _rejectedPassword, ...fields } = input;
    if (
      fields.email &&
      (await User.exists({
        email: fields.email,
        role: { $in: ['super_admin', 'admin', 'staff'] },
        _id: { $ne: id },
      }))
    ) {
      throw createHttpError(409, 'Email already exists');
    }
    const shouldRevokeSessions = Boolean(
      fields.active === false || fields.role
    );
    const revocation = shouldRevokeSessions
      ? sessionRevocationUpdate()
      : undefined;
    const update = {
      $set: {
        ...fields,
        ...revocation?.$set,
      },
      ...(revocation ? { $inc: revocation.$inc } : {}),
    };
    const saveUser = async (session?: ClientSession) => {
      const user = await User.findOneAndUpdate(
        { _id: id, role: { $in: roles } },
        update,
        {
          returnDocument: 'after',
          runValidators: true,
          ...(session ? { session } : {}),
        }
      );
      if (!user) throw createHttpError(404, 'User not found');
      return user;
    };
    if (fields.active !== undefined || fields.role !== undefined) {
      return withRelationsTransaction(async (session) => {
        if (fields.active === false || fields.role === 'staff')
          await protectLastAdmin(id, session, roles);
        if (
          fields.active === false &&
          (await Order.exists({
            userId: id,
            orderStatus: { $in: OPEN_ORDER_STATUSES },
          }).session(session))
        ) {
          throw createHttpError(
            409,
            'Reassign open orders before disabling this user'
          );
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
      if (await Order.exists({ userId: id }).session(session))
        throw createHttpError(409, 'Cannot delete a user referenced by orders');
      const deleted = await User.findOneAndDelete(
        { _id: id, role: { $in: roles } },
        { session }
      );
      if (!deleted) throw createHttpError(404, 'User not found');
    });
  },
};
