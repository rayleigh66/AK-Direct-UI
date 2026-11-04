import { randomUUID } from 'node:crypto';
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

async function internalAuthUser(pool: DbPool, row: InternalRow): Promise<AuthUser> {
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
    const lock = await recordLoginFailure(pool, attemptKey, config);
    if (lock.locked) {
      throw new HttpError(
        429,
        'rate_limited',
        'Too many failed sign-in attempts. Try again later.',
        lock.retryAfterSeconds
      );
    }
    throw invalidCredentials();
  }

  await clearLoginFailures(pool, attemptKey);

  let user: AuthUser;
  if (customerRow) {
    user = customerAuthUser(customerRow);
    await pool.query(
      'UPDATE customer_users SET last_login_at = now(), updated_at = now() WHERE id = $1',
      [customerRow.id]
    );
    const session = await createSession(pool, config, {
      userType: 'customer',
      customerUserId: customerRow.id,
      companyId: customerRow.company_id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await writeAudit(pool, {
      actorType: 'customer',
      actorId: customerRow.id,
      actorLabel: customerRow.username,
      action: 'LOGIN_SUCCESS',
      targetType: 'customer_user',
      targetId: customerRow.id,
    });
    return { user, session };
  }

  if (!internal) throw invalidCredentials();
  user = await internalAuthUser(pool, internal);
  await pool.query('UPDATE internal_users SET last_login_at = now(), updated_at = now() WHERE id = $1', [
    internal.id,
  ]);
  const session = await createSession(pool, config, {
    userType: 'internal',
    internalUserId: internal.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await writeAudit(pool, {
    actorType: 'internal',
    actorId: internal.id,
    actorLabel: internal.email,
    action: 'LOGIN_SUCCESS',
    targetType: 'internal_user',
    targetId: internal.id,
  });
  return { user, session };
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
  if (auth.user.type === 'customer') {
    await pool.query(
      `UPDATE customer_users
       SET password_hash = $2, must_change_password = false,
           password_changed_at = now(), updated_at = now()
       WHERE id = $1`,
      [auth.user.id, newHash]
    );
    await revokeSessionsForCustomerUser(pool, auth.user.id);
  } else {
    await pool.query(
      `UPDATE internal_users
       SET password_hash = $2, must_change_password = false,
           password_changed_at = now(), updated_at = now()
       WHERE id = $1`,
      [auth.user.id, newHash]
    );
    await revokeSessionsForInternalUser(pool, auth.user.id);
  }

  const refreshedUser: AuthUser = { ...auth.user, mustChangePassword: false };
  const session =
    auth.user.type === 'customer'
      ? await createSession(pool, config, {
          userType: 'customer',
          customerUserId: auth.user.id,
          companyId: auth.user.companyId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        })
      : await createSession(pool, config, {
          userType: 'internal',
          internalUserId: auth.user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

  await writeAudit(pool, {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
    action: 'PASSWORD_CHANGED',
    targetType: auth.user.type === 'customer' ? 'customer_user' : 'internal_user',
    targetId: auth.user.id,
  });

  return { user: refreshedUser, session };
}

export { generateInitialPassword };
