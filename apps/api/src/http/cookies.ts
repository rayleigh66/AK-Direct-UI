import type { Request, Response } from 'express';

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function readCookie(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  maxAgeSeconds: number;
  sameSite?: 'lax' | 'strict';
}

export function setCookie(
  res: Response,
  name: string,
  value: string,
  options: CookieOptions
): void {
  res.cookie(name, value, {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite ?? 'lax',
    path: '/',
    maxAge: options.maxAgeSeconds * 1000,
  });
}

export function clearCookie(res: Response, name: string, secure: boolean): void {
  res.clearCookie(name, {
    httpOnly: name.includes('session'),
    secure,
    sameSite: 'lax',
    path: '/',
  });
}
