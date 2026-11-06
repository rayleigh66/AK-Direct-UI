import { createHash } from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { AuthConfig } from './types.js';

export interface LockState {
  locked: boolean;
  retryAfterSeconds?: number;
}

export function loginAttemptKey(username: string, ip: string | undefined): string {
  return createHash('sha256')
    .update(`${username.trim().toLowerCase()}|${ip ?? 'unknown'}`, 'utf8')
    .digest('hex');
}

function retrySeconds(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

export async function checkLoginLock(pool: DbPool, key: string): Promise<LockState> {
  const result = await pool.query<{ locked_until: Date | null }>(
    'SELECT locked_until FROM login_attempts WHERE login_key = $1',
    [key]
  );
  const lockedUntil = result.rows[0]?.locked_until;
  if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
    return { locked: true, retryAfterSeconds: retrySeconds(new Date(lockedUntil), new Date()) };
  }
  return { locked: false };
}

export async function recordLoginFailure(
  pool: DbPool,
  key: string,
  config: AuthConfig
): Promise<LockState> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const now = new Date();
    const result = await client.query<{
      failed_count: number;
      window_start: Date;
      locked_until: Date | null;
    }>(
      `SELECT failed_count, window_start, locked_until
       FROM login_attempts WHERE login_key = $1 FOR UPDATE`,
      [key]
    );
    const row = result.rows[0];
    if (row?.locked_until && new Date(row.locked_until).getTime() > now.getTime()) {
      await client.query('COMMIT');
      return {
        locked: true,
        retryAfterSeconds: retrySeconds(new Date(row.locked_until), now),
      };
    }

    const windowStart = new Date(now.getTime() - config.loginWindowMinutes * 60_000);
    let failedCount = 1;
    if (row && new Date(row.window_start).getTime() >= windowStart.getTime()) {
      failedCount = row.failed_count + 1;
    }

    const lockedUntil =
      failedCount >= config.loginMaxAttempts
        ? new Date(now.getTime() + config.loginLockMinutes * 60_000)
        : null;

    await client.query(
      `INSERT INTO login_attempts (login_key, failed_count, window_start, locked_until, updated_at)
       VALUES ($1, $2, $3, $4, $3)
       ON CONFLICT (login_key) DO UPDATE SET
         failed_count = EXCLUDED.failed_count,
         window_start = EXCLUDED.window_start,
         locked_until = EXCLUDED.locked_until,
         updated_at = EXCLUDED.updated_at`,
      [key, failedCount, now, lockedUntil]
    );
    await client.query('COMMIT');

    if (lockedUntil) {
      return {
        locked: true,
        retryAfterSeconds: retrySeconds(lockedUntil, now),
      };
    }
    return { locked: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function clearLoginFailures(pool: Pick<DbPool, 'query'>, key: string): Promise<void> {
  await pool.query('DELETE FROM login_attempts WHERE login_key = $1', [key]);
}
