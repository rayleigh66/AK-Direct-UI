import { Router } from 'express';
import type { DbPool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../http/errors.js';
import { ensureCsrfToken, requireCsrf } from '../http/csrf.js';
import { requestIp, requestUserAgent } from '../http/request.js';
import { changePassword, login, logout } from './service.js';
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
} from './session.js';
import type { AuthConfig } from './types.js';

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_request', `${field} is required.`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, 'invalid_request', `${field} is too long.`);
  }
  return value;
}

export function createAuthRouter(pool: DbPool, config: AuthConfig): Router {
  const router = Router();
  const authRequired = requireAuth(pool, config);
  const csrfRequired = requireCsrf(config.cookieSecure);

  router.get('/csrf', (req, res) => {
    const csrfToken = ensureCsrfToken(req, res, config.cookieSecure);
    res.status(200).json({ csrfToken });
  });

  router.post(
    '/login',
    csrfRequired,
    asyncHandler(async (req, res) => {
      const username = readString(req.body?.username, 'username', 320);
      const password = readString(req.body?.password, 'password', 1024);
      const result = await login(pool, config, {
        username,
        password,
        ip: requestIp(req),
        userAgent: requestUserAgent(req),
      });
      setSessionCookie(res, config, result.session.token, result.session.absoluteExpiresAt);
      res.status(200).json({ user: result.user });
    })
  );

  router.get('/session', authRequired, (req, res) => {
    res.status(200).json({ user: req.auth!.user });
  });

  router.post(
    '/logout',
    authRequired,
    csrfRequired,
    asyncHandler(async (req, res) => {
      await logout(pool, req.auth!);
      clearSessionCookie(res, config);
      res.status(200).json({ status: 'ok' });
    })
  );

  router.post(
    '/change-password',
    authRequired,
    csrfRequired,
    asyncHandler(async (req, res) => {
      const currentPassword = readString(req.body?.currentPassword, 'currentPassword', 1024);
      const newPassword = readString(req.body?.newPassword, 'newPassword', 1024);
      const result = await changePassword(
        pool,
        config,
        req.auth!,
        currentPassword,
        newPassword,
        { ip: requestIp(req), userAgent: requestUserAgent(req) }
      );
      setSessionCookie(res, config, result.session.token, result.session.absoluteExpiresAt);
      res.status(200).json({ user: result.user });
    })
  );

  return router;
}
