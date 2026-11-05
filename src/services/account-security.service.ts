import argon2 from 'argon2';
import createHttpError from 'http-errors';
import { Customer } from '../models/customers.model.js';
import { CustomerOtpJob } from '../models/customer-otp-jobs.model.js';
import { User } from '../models/users.model.js';
import { emailService } from './email.service.js';
import { newOtp, newSecret, securityDigest, OTP_LIFETIME_MS, OTP_COOLDOWN_MS } from '../utils/account-security.js';
import { sessionRevocationUpdate } from '../utils/session.js';
import { verifyPassword } from '../utils/password.js';
import type { SecurityChallenge } from '../models/security-challenge.schema.js';
import type { AuthUser } from '../types/auth.type.js';
import { createEmailSchema } from '../validations/common.validation.js';

const invalidOtp = () => createHttpError(400, 'Mã xác nhận không hợp lệ hoặc đã hết hạn.');
const versionFilter = (version: number) => ({
  $or: [{ tokenVersion: version }, ...(version === 0 ? [{ tokenVersion: { $exists: false } }] : [])],
});

function issueChallenge(email: string, version: number, purpose: string) {
  const otp = newOtp();
  const id = newSecret();
  const now = Date.now();
  const challenge: SecurityChallenge = {
    id, hash: securityDigest(purpose, `${id}:${otp}`), email, version,
    status: 'pending', expiresAt: new Date(now + OTP_LIFETIME_MS),
    resendAt: new Date(now + OTP_COOLDOWN_MS), attempts: 0,
  };
  return { otp, challenge };
}

export async function sendCustomerOtp(email: string): Promise<void> {
  email = createEmailSchema().parse(email);
  try {
    const now = Date.now();
    // Never look up the account or wait for SMTP on the public request path.
    await CustomerOtpJob.create({
      email, runAt: new Date(now), expiresAt: new Date(now + 10 * 60_000),
    });
  } catch {
    // Public recovery must not reveal account eligibility through delivery,
    // configuration or account-specific persistence failures. Never log the
    // recipient, OTP, challenge, credentials or upstream error details.
    console.error('Customer recovery OTP queue unavailable');
  }
}

export type CustomerOtpDeliveryResult =
  | { status: 'delivered' | 'skipped' }
  | { status: 'deferred'; retryAt: Date };

export async function deliverCustomerOtp(email: string): Promise<CustomerOtpDeliveryResult> {
  const customer = await Customer.findOne({ email, accountEnabled: true, isActive: true })
    .select('+tokenVersion +passwordRecovery');
  if (!customer) return { status: 'skipped' };
  const { otp, challenge } = issueChallenge(email, customer.tokenVersion ?? 0, 'customer-otp');
  const reserved = await Customer.findOneAndUpdate({
    _id: customer._id, email, accountEnabled: true, isActive: true,
    ...versionFilter(challenge.version),
    $and: [{ $or: [
      { passwordRecovery: { $exists: false } },
      { 'passwordRecovery.resendAt': { $lte: new Date() } },
    ] }],
  }, { $set: { passwordRecovery: challenge } });
  if (!reserved) {
    // A failed cleanup or another worker can leave a not-yet-delivered code.
    // Re-read after the failed CAS; the first lookup may already be stale.
    const current = await Customer.findOne({
      _id: customer._id, email, accountEnabled: true, isActive: true,
    }).select('+passwordRecovery +tokenVersion');
    if (!current) return { status: 'skipped' };
    const recovery = current.passwordRecovery;
    if (recovery?.status !== 'pending' && recovery &&
        recovery.version === (current.tokenVersion ?? 0) &&
        recovery.resendAt.getTime() > Date.now()) return { status: 'skipped' };
    // Waiting for a pending code is not a delivery failure and must not consume
    // another SMTP attempt. The job's expiry still bounds the total wait.
    return { status: 'deferred', retryAt: new Date(Math.max(
      Date.now() + 1000, recovery?.resendAt.getTime() ?? 0
    )) };
  }
  try {
    await emailService.send(email, 'Mã xác nhận đặt lại mật khẩu',
      `Mã xác nhận của bạn: ${otp}\nMã có hiệu lực 5 phút. Không chia sẻ mã này.`);
    const activated = await Customer.findOneAndUpdate({
      _id: customer._id, email, accountEnabled: true, isActive: true,
      ...versionFilter(challenge.version), 'passwordRecovery.id': challenge.id,
      'passwordRecovery.status': 'pending', 'passwordRecovery.expiresAt': { $gt: new Date() },
    }, { $set: { 'passwordRecovery.status': 'active' } });
    if (!activated) throw createHttpError(409, 'Tài khoản đã thay đổi. Vui lòng yêu cầu mã mới.');
    return { status: 'delivered' };
  } catch (error) {
    await Customer.updateOne({ _id: customer._id, 'passwordRecovery.id': challenge.id },
      { $unset: { passwordRecovery: 1 } });
    throw error;
  }
}

export async function verifyCustomerOtp(email: string, otp: string) {
  const customer = await Customer.findOneAndUpdate({
    email, accountEnabled: true, isActive: true,
    'passwordRecovery.email': email, 'passwordRecovery.status': 'active',
    'passwordRecovery.expiresAt': { $gt: new Date() }, 'passwordRecovery.attempts': { $lt: 5 },
  }, { $inc: { 'passwordRecovery.attempts': 1 } }, { returnDocument: 'after' })
    .select('+passwordRecovery +tokenVersion');
  const challenge = customer?.passwordRecovery;
  if (!customer || !challenge || challenge.version !== (customer.tokenVersion ?? 0) ||
      challenge.hash !== securityDigest('customer-otp', `${challenge.id}:${otp}`)) throw invalidOtp();
  const resetToken = newSecret();
  const consumed = await Customer.findOneAndUpdate({
    _id: customer._id, email, accountEnabled: true, isActive: true,
    ...versionFilter(challenge.version), 'passwordRecovery.id': challenge.id,
    'passwordRecovery.status': 'active', 'passwordRecovery.expiresAt': { $gt: new Date() },
    'passwordRecovery.attempts': { $lte: 5 },
  }, {
    $set: { 'passwordRecovery.status': 'consumed',
      'passwordRecovery.resetHash': securityDigest('customer-reset', resetToken),
      'passwordRecovery.resetExpiresAt': new Date(Date.now() + OTP_LIFETIME_MS) },
    $unset: { 'passwordRecovery.hash': 1 },
  });
  if (!consumed) throw invalidOtp();
  return { resetToken, expiresIn: OTP_LIFETIME_MS / 1000 };
}

export async function resetCustomerPassword(input: { email: string; resetToken: string; newPassword: string }) {
  const resetHash = securityDigest('customer-reset', input.resetToken);
  const customer = await Customer.findOne({
    email: input.email, accountEnabled: true, isActive: true,
    'passwordRecovery.status': 'consumed', 'passwordRecovery.resetHash': resetHash,
    'passwordRecovery.resetExpiresAt': { $gt: new Date() },
  }).select('+password +passwordRecovery +tokenVersion');
  if (!customer?.passwordRecovery || !customer.password) throw invalidOtp();
  if ((await verifyPassword(customer.password, input.newPassword)).valid)
    throw createHttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.');
  const password = await argon2.hash(input.newPassword);
  const revocation = sessionRevocationUpdate();
  const updated = await Customer.findOneAndUpdate({
    _id: customer._id, email: input.email, password: customer.password,
    accountEnabled: true, isActive: true,
    ...versionFilter(customer.passwordRecovery.version),
    'passwordRecovery.status': 'consumed', 'passwordRecovery.resetHash': resetHash,
    'passwordRecovery.resetExpiresAt': { $gt: new Date() },
  }, { $set: { ...revocation.$set, password, mustChangePassword: false },
    $inc: revocation.$inc, $unset: { passwordRecovery: 1 } }, { runValidators: true });
  if (!updated) throw invalidOtp();
}

export async function sendEmailVerification(actor: AuthUser) {
  const user = await User.findOne({ _id: actor.id, active: true, mustChangePassword: { $ne: true },
    ...versionFilter(actor.tokenVersion ?? 0) }).select('+emailVerification');
  if (!user) throw createHttpError(401, 'Session is no longer valid');
  const email = createEmailSchema().parse(user.personalEmail);
  if (user.personalEmailVerified) throw createHttpError(409, 'Email đã được xác nhận.');
  const { otp, challenge } = issueChallenge(email, actor.tokenVersion ?? 0, 'user-email');
  const reserved = await User.findOneAndUpdate({
    _id: actor.id, active: true, personalEmail: email, personalEmailVerified: { $ne: true },
    mustChangePassword: { $ne: true }, ...versionFilter(challenge.version),
    $and: [{ $or: [ { emailVerification: { $exists: false } },
      { 'emailVerification.resendAt': { $lte: new Date() } } ] }],
  }, { $set: { emailVerification: challenge } });
  if (!reserved) throw createHttpError(429, 'Vui lòng chờ trước khi gửi lại mã.', { retryAfter: 60 });
  try {
    await emailService.send(email, 'Xác nhận email cá nhân',
      `Mã xác nhận email của bạn: ${otp}\nMã có hiệu lực 5 phút. Không chia sẻ mã này.`);
    const activated = await User.findOneAndUpdate({ _id: actor.id, active: true,
      ...versionFilter(challenge.version), personalEmail: email,
      'emailVerification.id': challenge.id, 'emailVerification.status': 'pending',
      'emailVerification.expiresAt': { $gt: new Date() },
    }, { $set: { 'emailVerification.status': 'active' } });
    if (!activated) throw createHttpError(409, 'Thông tin đã thay đổi. Vui lòng gửi lại mã.');
  } catch (error) {
    await User.updateOne({ _id: actor.id, 'emailVerification.id': challenge.id },
      { $unset: { emailVerification: 1 } });
    throw error;
  }
}

export async function verifyPersonalEmail(actor: AuthUser, otp: string) {
  const user = await User.findOneAndUpdate({
    _id: actor.id, active: true, mustChangePassword: { $ne: true },
    ...versionFilter(actor.tokenVersion ?? 0),
    'emailVerification.status': 'active', 'emailVerification.expiresAt': { $gt: new Date() },
    'emailVerification.attempts': { $lt: 5 },
  }, { $inc: { 'emailVerification.attempts': 1 } }, { returnDocument: 'after' }).select('+emailVerification');
  const challenge = user?.emailVerification;
  if (!user || !challenge || challenge.email !== user.personalEmail ||
      challenge.version !== (actor.tokenVersion ?? 0) ||
      challenge.hash !== securityDigest('user-email', `${challenge.id}:${otp}`)) throw invalidOtp();
  const updated = await User.findOneAndUpdate({
    _id: actor.id, active: true, mustChangePassword: { $ne: true },
    ...versionFilter(challenge.version), personalEmail: challenge.email,
    firstName: { $regex: /\S/ }, lastName: { $regex: /\S/ },
    'emailVerification.id': challenge.id, 'emailVerification.status': 'active',
    'emailVerification.expiresAt': { $gt: new Date() }, 'emailVerification.attempts': { $lte: 5 },
  }, { $set: { personalEmailVerified: true, onboardingRequired: false },
    $unset: { emailVerification: 1 } });
  if (!updated) throw invalidOtp();
}
