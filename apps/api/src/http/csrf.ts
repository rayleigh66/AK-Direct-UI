import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { readCookie, setCookie } from './cookies.js';

export const CSRF_COOKIE = 'aoking_csrf';
const CSRF_TTL_SECONDS = 24 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function ensureCsrfToken(req: Request, res: Response, secure: boolean): string {
  const existing = readCookie(req, CSRF_COOKIE);
  if (existing && existing.length >= 32) return existing;
  const token = randomBytes(32).toString('base64url');
  setCookie(res, CSRF_COOKIE, token, {
    httpOnly: false,
    secure,
    maxAgeSeconds: CSRF_TTL_SECONDS,
    sameSite: 'lax',
  });
  return token;
}

export function requireCsrf(cookieSecure: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookieToken = readCookie(req, CSRF_COOKIE);
    const headerToken = req.get('x-csrf-token');
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      res.status(403).json({
        error: {
          code: 'csrf_failed',
          message: 'CSRF validation failed. Refresh the page and try again.',
        },
      });
      return;
    }
    // Keep the double-submit cookie alive on state-changing requests.
    setCookie(res, CSRF_COOKIE, cookieToken, {
      httpOnly: false,
      secure: cookieSecure,
      maxAgeSeconds: CSRF_TTL_SECONDS,
      sameSite: 'lax',
    });
    next();
  };
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Applies the double-submit check to every state-changing method so a router
 * cannot forget it on an individual route. Safe methods pass through.
 */
export function requireCsrfForUnsafeMethods(cookieSecure: boolean) {
  const check = requireCsrf(cookieSecure);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!UNSAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }
    check(req, res, next);
  };
}
