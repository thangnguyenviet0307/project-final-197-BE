import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { RequestHandler } from 'express';
import createError from 'http-errors';
import {
  authenticateCustomer,
  type CustomerRequest,
} from '../../middlewares/customers/customer-auth.middleware.js';
import { verifyAccessToken } from '../../utils/auth/token.js';
import { Customer } from '../../models/customers/customers.model.js';
import { frontendOrigins } from '../../config/frontend-origins.js';
import type { AiOwner } from '../../types/ai/ai.types.js';
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const sign = (value: string) => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw createError(503, 'AI identity is not configured');
  return createHmac('sha256', secret)
    .update('ai-guest:' + value)
    .digest('hex');
};
export const aiOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && !frontendOrigins().includes(origin))
    return next(createError(403, 'Untrusted origin'));
  if (!origin && !['GET', 'HEAD'].includes(req.method))
    return next(createError(403, 'Origin required'));
  next();
};
function identify(initialize: boolean): RequestHandler {
  return (req, res, next) => {
    if (req.headers.authorization)
      return authenticateCustomer(req, res, (error) => {
        if (error) return next(error);
        res.locals['aiOwner'] = {
          kind: 'customer',
          id: String((req as CustomerRequest).customer!._id),
        } satisfies AiOwner;
        return next();
      });
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('aiGuest='))
      ?.slice(8);
    let token = cookie?.split('.')[0] ?? '';
    const signature = cookie?.split('.')[1] ?? '';
    const expected = sign(token);
    if (
      !/^[a-f0-9]{64}$/.test(token) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      if (!initialize)
        return next(
          createError(428, 'Khởi tạo phiên chatbot trước khi tiếp tục.')
        );
      token = randomBytes(32).toString('hex');
    }
    if (initialize) {
      res.cookie('aiGuest', token + '.' + sign(token), {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/api/v1/ai',
        maxAge: 2 * 86400000,
      });
    }
    res.locals['aiOwner'] = {
      kind: 'guest',
      id: digest(token),
    } satisfies AiOwner;
    return next();
  };
}
export const aiIdentity: RequestHandler = identify(false);
export const initializeAiSession: RequestHandler = identify(true);
export async function checkCustomerToken(token: string): Promise<string> {
  const payload = verifyAccessToken(token);
  if (payload.accountType !== 'customer')
    throw createError(403, 'Customer session required');
  const customer = await Customer.findById(payload.userId).select(
    '+tokenVersion'
  );
  if (
    !customer?.isActive ||
    !customer.accountEnabled ||
    customer.mustChangePassword ||
    (customer.tokenVersion ?? 0) !== payload.version
  )
    throw createError(401, 'Customer session expired');
  return payload.userId;
}
