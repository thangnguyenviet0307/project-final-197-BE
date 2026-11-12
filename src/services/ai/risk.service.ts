import { aiConfig, withAiConfig } from './config.js';
import type { RequestHandler } from 'express';
import { consumeUsage, recordRisk } from './usage.service.js';
import { digest } from './identity.service.js';
export const observeRisk: RequestHandler = (req, res, next) => {
  const login = /^\/api\/v1\/(?:customer-auth|auth)\/login$/.test(req.path);
  const checkout = req.path === '/api/v1/storefront/checkout';
  if (req.method === 'POST' && (login || checkout))
    res.once('finish', () => {
      if (login && res.statusCode < 400) return;
      void withAiConfig(async () => {
        if (!aiConfig().riskEnabled) return;
        const actorHash = digest(req.ip || 'unknown');
        const key = `risk:${login ? 'login' : 'checkout'}:${actorHash}`;
        await consumeUsage(key, login ? 10 : 8, 10 * 60000).then(
          async (allowed) => {
            if (allowed) return;
            await recordRisk(
              key,
              login ? 'login_failures' : 'checkout_velocity',
              login
                ? 'Nhiều lần đăng nhập thất bại trong 10 phút'
                : 'Nhiều yêu cầu checkout trong 10 phút',
              70,
              10 * 60000
            );
          }
        );
      }).catch(() => {
        console.error('AI risk recording failed');
      });
    });
  next();
};
