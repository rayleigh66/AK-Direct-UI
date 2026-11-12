import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction.js';
import type { DbPool } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { writeAudit } from '../audit/audit.js';
import {
  checkLoginLock,
  clearLoginFailures,
  loginAttemptKey,
  recordLoginFailure,
} from './loginAttempts.js';
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
  generateInitialPassword,
} from './password.js';
import {
  createSession,
  loadInternalAccess,
  revokeSession,
  revokeSessionsForCustomerUser,
  revokeSessionsForInternalUser,
  type CreatedSession,
} from './session.js';
import type { AuthConfig, AuthContext, AuthUser } from './types.js';

interface CustomerRow {
  id: string;
  company_id: string;
  username: string;
  password_hash: string;
  must_change_password: boolean;
  status: string;
  company_status: string;
  customer_code: string;
  company_name: string;
}

interface InternalRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  must_change_password: boolean;
  status: string;
}

export interface LoginInput {
  username: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface LoginOutput {
  user: AuthUser;
  session: CreatedSession;
}

let dummyHashPromise: Promise<string> | null = null;
async function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomUUID());
  return dummyHashPromise;
}

function customerAuthUser(row: CustomerRow): AuthUser {
  return {
    id: row.id,
    type: 'customer',
    username: row.username,
    displayName: row.username,
    companyId: row.company_id,
    companyCode: row.customer_code,
    companyName: row.company_name,
    roles: ['customer'],
    permissions: ['customer.self'],
    mustChangePassword: row.must_change_password,
  };
}

async function internalAuthUser(pool: Pick<DbPool, 'query'>, row: InternalRow): Promise<AuthUser> {
  const access = await loadInternalAccess(pool, row.id);
  return {
    id: row.id,
    type: 'internal',
    username: row.email,
    displayName: row.name,
    roles: access.roles,
    permissions: access.permissions,
    mustChangePassword: row.must_change_password,
  };
}

function invalidCredentials(): HttpError {
  return new HttpError(401, 'invalid_credentials', 'Invalid username or password.');
}

/** Account writers and issuers serialize company -> account -> sessions.
 * Scrypt stays outside these locks; the verified hash is rechecked inside them.
 */
async function lockCredentials(
  client: PoolClient,
  type: AuthUser['type'],
  userId: string,
  companyId?: string
): Promise<{ passwordHash: string; user: AuthUser } | null> {
  if (type === 'customer') {
    if (!companyId) return null;
    await client.query('SELECT id FROM customer_companies WHERE id = $1 FOR SHARE', [companyId]);
    const result = await client.query<CustomerRow>(
      `SELECT cu.id, cu.company_id, cu.username, cu.password_hash,
              cu.must_change_password, cu.status,
              c.status AS company_status, c.customer_code, c.short_name AS company_name
       FROM customer_users cu JOIN customer_companies c ON c.id = cu.company_id
       WHERE cu.id = $1 AND cu.company_id = $2 FOR UPDATE OF cu`,
      [userId, companyId]
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active' || row.company_status !== 'active') return null;
    return { passwordHash: row.password_hash, user: customerAuthUser(row) };
  }
  const result = await client.query<InternalRow>(
    `SELECT id, email, name, password_hash, must_change_password, status
     FROM internal_users WHERE id = $1 FOR UPDATE`, [userId]
  );
  const row = result.rows[0];
  if (!row || row.status !== 'active') return null;
  return { passwordHash: row.password_hash, user: await internalAuthUser(client, row) };
}

async function rejectLogin(pool: DbPool, key: string, config: AuthConfig): Promise<never> {
  const lock = await recordLoginFailure(pool, key, config);
  if (lock.locked) {
    throw new HttpError(429, 'rate_limited', 'Too many failed sign-in attempts. Try again later.', lock.retryAfterSeconds);
  }
  throw invalidCredentials();
}

export async function login(
  pool: DbPool,
  config: AuthConfig,
  input: LoginInput
): Promise<LoginOutput> {
  const username = input.username.trim();
  if (!username || !input.password) {
    throw new HttpError(400, 'invalid_request', 'Username and password are required.');
  }

  const attemptKey = loginAttemptKey(username, input.ip);
  const initialLock = await checkLoginLock(pool, attemptKey);
  if (initialLock.locked) {
    throw new HttpError(
      429,
      'rate_limited',
      'Too many failed sign-in attempts. Try again later.',
      initialLock.retryAfterSeconds
    );
  }

  const customer = await pool.query<CustomerRow>(
    `SELECT cu.id, cu.company_id, cu.username, cu.password_hash,
            cu.must_change_password, cu.status,
            c.status AS company_status, c.customer_code, c.short_name AS company_name
     FROM customer_users cu
     JOIN customer_companies c ON c.id = cu.company_id
     WHERE cu.username = $1
     LIMIT 1`,
    [username.toUpperCase()]
  );
  let internal: InternalRow | undefined;
  if (customer.rows.length === 0) {
    const internalResult = await pool.query<InternalRow>(
      `SELECT id, email, name, password_hash, must_change_password, status
       FROM internal_users WHERE email = $1 LIMIT 1`,
      [username.toLowerCase()]
    );
    internal = internalResult.rows[0];
  }

  const customerRow = customer.rows[0];
  const row = customerRow ?? internal;
  const passwordHash = row?.password_hash ?? (await getDummyHash());
  const passwordValid = await verifyPassword(input.password, passwordHash);

  const eligible =
    (customerRow && customerRow.status === 'active' && customerRow.company_status === 'active') ||
    (internal && internal.status === 'active');

  if (!row || !eligible || !passwordValid) {
    return rejectLogin(pool, attemptKey, config);
  }

  try {
    return await withTransaction(pool, async client => {
      const type = customerRow ? 'customer' : 'internal';
      const current = await lockCredentials(client, type, row.id, customerRow?.company_id);
      // A verified-but-stale password or suspended account cannot issue a session.
      if (!current || current.passwordHash !== passwordHash) throw invalidCredentials();
      await clearLoginFailures(client, attemptKey);
      await client.query(
        `UPDATE ${type === 'customer' ? 'customer_users' : 'internal_users'}
         SET last_login_at = now(), updated_at = now() WHERE id = $1`, [row.id]
      );
      const session = await createSession(client, config, {
        userType: type,
        ...(type === 'customer'
          ? { customerUserId: row.id, companyId: customerRow!.company_id }
          : { internalUserId: row.id }),
        ip: input.ip,
        userAgent: input.userAgent,
      });
      await writeAudit(client, {
        actorType: type, actorId: row.id, actorLabel: current.user.username,
        action: 'LOGIN_SUCCESS', targetType: type === 'customer' ? 'customer_user' : 'internal_user', targetId: row.id,
      });
      return { user: current.user, session };
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === 'invalid_credentials') {
      return rejectLogin(pool, attemptKey, config);
    }
    throw error;
  }
}

export async function logout(
  pool: DbPool,
  auth: AuthContext
): Promise<void> {
  await revokeSession(pool, auth.sessionId);
  await writeAudit(pool, {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
    action: 'LOGOUT',
    targetType: 'auth_session',
    targetId: auth.sessionId,
  });
}

export interface ChangedPasswordOutput {
  user: AuthUser;
  session: CreatedSession;
}

export async function changePassword(
  pool: DbPool,
  config: AuthConfig,
  auth: AuthContext,
  currentPassword: string,
  newPassword: string,
  meta: { ip?: string; userAgent?: string }
): Promise<ChangedPasswordOutput> {
  if (!currentPassword || !newPassword) {
    throw new HttpError(400, 'invalid_request', 'Current and new passwords are required.');
  }

  if (currentPassword === newPassword) {
    throw new HttpError(400, 'same_password', 'The new password must differ from the current password.');
  }
  const policy = validatePasswordPolicy(newPassword, auth.user.username);
  if (!policy.valid) {
    throw new HttpError(400, 'weak_password', policy.error ?? 'Password is not strong enough.');
  }

  let storedHash: string | undefined;
  if (auth.user.type === 'customer') {
    const result = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM customer_users WHERE id = $1 AND status = $2',
      [auth.user.id, 'active']
    );
    storedHash = result.rows[0]?.password_hash;
  } else {
    const result = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM internal_users WHERE id = $1 AND status = $2',
      [auth.user.id, 'active']
    );
    storedHash = result.rows[0]?.password_hash;
  }
  if (!storedHash || !(await verifyPassword(currentPassword, storedHash))) {
    throw new HttpError(401, 'invalid_current_password', 'Current password is incorrect.');
  }

  const newHash = await hashPassword(newPassword);
  return withTransaction(pool, async client => {
    const current = await lockCredentials(client, auth.user.type, auth.user.id, auth.user.companyId);
    if (!current || current.passwordHash !== storedHash) {
      throw new HttpError(401, 'invalid_current_password', 'Current password is incorrect.');
    }
    // Middleware authentication may predate a concurrent revoke/logout. Check
    // the authenticating session again under the account lock before replacing it.
    const sessionRow = await client.query(
      `SELECT id FROM auth_sessions
       WHERE id = $1 AND token_hash = $2 AND user_type = $3
         AND ${auth.user.type === 'customer' ? 'customer_user_id' : 'internal_user_id'} = $4
         AND revoked_at IS NULL AND idle_expires_at > clock_timestamp()
         AND absolute_expires_at > clock_timestamp() FOR UPDATE`,
      [auth.sessionId, auth.sessionTokenHash, auth.user.type, auth.user.id]
    );
    if (sessionRow.rowCount !== 1) {
      throw new HttpError(401, 'session_expired', 'Your session has expired.');
    }
    await client.query(
      `UPDATE ${auth.user.type === 'customer' ? 'customer_users' : 'internal_users'}
       SET password_hash = $2, must_change_password = false,
           password_changed_at = now(), updated_at = now() WHERE id = $1`,
      [auth.user.id, newHash]
    );
    if (auth.user.type === 'customer') {
      await revokeSessionsForCustomerUser(client, auth.user.id);
    } else {
      await revokeSessionsForInternalUser(client, auth.user.id);
    }
    const session = await createSession(client, config, {
      userType: auth.user.type,
      ...(auth.user.type === 'customer'
        ? { customerUserId: auth.user.id, companyId: current.user.companyId }
        : { internalUserId: auth.user.id }),
      ip: meta.ip, userAgent: meta.userAgent,
    });
    await writeAudit(client, {
      actorType: auth.user.type, actorId: auth.user.id, actorLabel: current.user.username,
      action: 'PASSWORD_CHANGED', targetType: auth.user.type === 'customer' ? 'customer_user' : 'internal_user', targetId: auth.user.id,
    });
    return { user: { ...current.user, mustChangePassword: false }, session };
  });
}

export { generateInitialPassword };
