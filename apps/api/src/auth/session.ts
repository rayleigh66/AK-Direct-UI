import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DbPool } from '../db/pool.js';
import { clearCookie, readCookie, setCookie } from '../http/cookies.js';
import type { AuthConfig, AuthContext, AuthUser, UserType } from './types.js';

export const SESSION_COOKIE = 'aoking_session';
const INTERNAL_ABSOLUTE_HOURS_DEFAULT = 12;

interface SessionRow {
  id: string;
  user_type: UserType;
  customer_user_id: string | null;
  internal_user_id: string | null;
  company_id: string | null;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  customer_username: string | null;
  customer_status: string | null;
  customer_must_change: boolean | null;
  customer_code: string | null;
  company_name: string | null;
  company_status: string | null;
  internal_name: string | null;
  internal_email: string | null;
  internal_status: string | null;
  internal_must_change: boolean | null;
}

interface CreateSessionInput {
  userType: UserType;
  customerUserId?: string;
  internalUserId?: string;
  companyId?: string;
  ip?: string;
  userAgent?: string;
}

export interface CreatedSession {
  sessionId: string;
  token: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function hashOptional(value: string | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sessionDurations(config: AuthConfig, userType: UserType) {
  if (userType === 'internal') {
    return {
      idleHours: config.internalSessionIdleHours,
      absoluteHours:
        config.internalSessionAbsoluteHours || INTERNAL_ABSOLUTE_HOURS_DEFAULT,
    };
  }
  return {
    idleHours: config.customerSessionIdleHours,
    absoluteHours: config.customerSessionAbsoluteDays * 24,
  };
}

export async function createSession(
  pool: DbPool,
  config: AuthConfig,
  input: CreateSessionInput
): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const sessionId = randomUUID();
  const now = new Date();
  const durations = sessionDurations(config, input.userType);
  const idleExpiresAt = new Date(now.getTime() + durations.idleHours * 3_600_000);
  const absoluteExpiresAt = new Date(now.getTime() + durations.absoluteHours * 3_600_000);

  await pool.query(
    `INSERT INTO auth_sessions
      (id, token_hash, user_type, customer_user_id, internal_user_id, company_id,
       created_at, last_seen_at, idle_expires_at, absolute_expires_at, ip_hash, user_agent_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11)`,
    [
      sessionId,
      tokenHash,
      input.userType,
      input.customerUserId ?? null,
      input.internalUserId ?? null,
      input.companyId ?? null,
      now,
      idleExpiresAt,
      absoluteExpiresAt,
      hashOptional(input.ip),
      hashOptional(input.userAgent),
    ]
  );

  return { sessionId, token, idleExpiresAt, absoluteExpiresAt };
}

export async function loadInternalAccess(
  pool: DbPool,
  internalUserId: string
): Promise<{ roles: string[]; permissions: string[] }> {
  const [roles, permissions] = await Promise.all([
    pool.query<{ role_id: string }>(
      'SELECT role_id FROM internal_user_roles WHERE internal_user_id = $1',
      [internalUserId]
    ),
    pool.query<{ permission_id: string }>(
      `SELECT DISTINCT permission_id FROM (
         SELECT rp.permission_id
         FROM internal_user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE ur.internal_user_id = $1
         UNION
         SELECT permission_id
         FROM internal_user_permissions
         WHERE internal_user_id = $1
       ) access
       ORDER BY permission_id`,
      [internalUserId]
    ),
  ]);
  return {
    roles: roles.rows.map(row => row.role_id),
    permissions: permissions.rows.map(row => row.permission_id),
  };
}

export async function findSession(
  pool: DbPool,
  config: AuthConfig,
  token: string
): Promise<AuthContext | null> {
  const tokenHash = hashToken(token);
  const result = await pool.query<SessionRow>(
    `SELECT s.id, s.user_type, s.customer_user_id, s.internal_user_id, s.company_id,
            s.idle_expires_at, s.absolute_expires_at,
            cu.username AS customer_username, cu.status AS customer_status,
            cu.must_change_password AS customer_must_change,
            c.customer_code, c.short_name AS company_name, c.status AS company_status,
            iu.name AS internal_name, iu.email AS internal_email,
            iu.status AS internal_status, iu.must_change_password AS internal_must_change
     FROM auth_sessions s
     LEFT JOIN customer_users cu ON cu.id = s.customer_user_id
     LEFT JOIN customer_companies c ON c.id = s.company_id
     LEFT JOIN internal_users iu ON iu.id = s.internal_user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;

  const now = new Date();
  const idleExpired = new Date(row.idle_expires_at).getTime() <= now.getTime();
  const absoluteExpired = new Date(row.absolute_expires_at).getTime() <= now.getTime();
  const inactive =
    (row.user_type === 'customer' &&
      (row.customer_status !== 'active' || row.company_status !== 'active')) ||
    (row.user_type === 'internal' && row.internal_status !== 'active');
  if (idleExpired || absoluteExpired || inactive) {
    await pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1', [row.id]);
    return null;
  }

  const durations = sessionDurations(config, row.user_type);
  const newIdle = new Date(
    Math.min(
      now.getTime() + durations.idleHours * 3_600_000,
      new Date(row.absolute_expires_at).getTime()
    )
  );
  await pool.query(
    'UPDATE auth_sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1',
    [row.id, now, newIdle]
  );

  let user: AuthUser;
  if (row.user_type === 'customer') {
    if (!row.customer_user_id || !row.company_id || !row.customer_username) return null;
    user = {
      id: row.customer_user_id,
      type: 'customer',
      username: row.customer_username,
      displayName: row.customer_username,
      companyId: row.company_id,
      companyCode: row.customer_code ?? undefined,
      companyName: row.company_name ?? undefined,
      roles: ['customer'],
      permissions: ['customer.self'],
      mustChangePassword: row.customer_must_change === true,
    };
  } else {
    if (!row.internal_user_id || !row.internal_email) return null;
    const access = await loadInternalAccess(pool, row.internal_user_id);
    user = {
      id: row.internal_user_id,
      type: 'internal',
      username: row.internal_email,
      displayName: row.internal_name ?? row.internal_email,
      roles: access.roles,
      permissions: access.permissions,
      mustChangePassword: row.internal_must_change === true,
    };
  }

  return { sessionId: row.id, sessionTokenHash: tokenHash, user };
}

export function setSessionCookie(
  res: Response,
  config: AuthConfig,
  token: string,
  absoluteExpiresAt: Date
): void {
  setCookie(res, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    maxAgeSeconds: Math.max(
      60,
      Math.floor((absoluteExpiresAt.getTime() - Date.now()) / 1000)
    ),
    sameSite: 'lax',
  });
}

export function clearSessionCookie(res: Response, config: AuthConfig): void {
  clearCookie(res, SESSION_COOKIE, config.cookieSecure);
}

export async function revokeSession(pool: DbPool, sessionId: string): Promise<void> {
  await pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
}

export async function revokeSessionsForCustomerUser(
  pool: DbPool,
  customerUserId: string
): Promise<void> {
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE customer_user_id = $1 AND revoked_at IS NULL',
    [customerUserId]
  );
}

export async function revokeSessionsForCompany(pool: DbPool, companyId: string): Promise<void> {
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE company_id = $1 AND revoked_at IS NULL',
    [companyId]
  );
}

export async function revokeSessionsForInternalUser(
  pool: DbPool,
  internalUserId: string
): Promise<void> {
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE internal_user_id = $1 AND revoked_at IS NULL',
    [internalUserId]
  );
}

export function requireAuth(pool: DbPool, config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      res.status(401).json({
        error: { code: 'authentication_required', message: 'Sign in is required.' },
      });
      return;
    }
    findSession(pool, config, token)
      .then(auth => {
        if (!auth) {
          clearSessionCookie(res, config);
          res.status(401).json({
            error: { code: 'session_expired', message: 'Your session has expired.' },
          });
          return;
        }
        req.auth = auth;
        next();
      })
      .catch(next);
  };
}

export function requirePasswordChanged(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.user.mustChangePassword) {
    res.status(403).json({
      error: {
        code: 'password_change_required',
        message: 'Change your initial password before accessing this resource.',
      },
    });
    return;
  }
  next();
}

export function hasPermission(auth: AuthContext | undefined, permission: string): boolean {
  return auth?.user.permissions.includes(permission) ?? false;
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({
        error: { code: 'authentication_required', message: 'Sign in is required.' },
      });
      return;
    }
    if (!hasPermission(req.auth, permission)) {
      res.status(403).json({
        error: { code: 'forbidden', message: 'You do not have permission for this action.' },
      });
      return;
    }
    next();
  };
}

export function requireUserType(type: UserType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.auth?.user.type !== type) {
      res.status(403).json({
        error: { code: 'forbidden', message: 'This resource is not available for your account type.' },
      });
      return;
    }
    next();
  };
}
