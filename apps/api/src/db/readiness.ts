import type { DbPool } from './pool.js';

export const EXPECTED_SCHEMA_VERSION = '4b02';
export const REQUIRED_MIGRATION = '002_auth_rbac.sql';

export interface ReadinessResult {
  ok: boolean;
  checks: Record<string, string>;
  error?: string;
}

/**
 * Readiness must fail closed. Only stable machine-readable codes are returned;
 * database errors and connection strings are never exposed to HTTP clients.
 */
export async function checkReadiness(pool: DbPool): Promise<ReadinessResult> {
  const checks: Record<string, string> = {};

  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'unavailable';
    return { ok: false, checks, error: 'database_unavailable' };
  }

  try {
    const metadata = await pool.query<{ value: string }>(
      "SELECT value FROM system_metadata WHERE key = 'schema_version' LIMIT 1"
    );
    if (metadata.rows[0]?.value !== EXPECTED_SCHEMA_VERSION) {
      checks.migrations = 'version_mismatch';
      return { ok: false, checks, error: 'unexpected_schema_version' };
    }

    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1 LIMIT 1',
      [REQUIRED_MIGRATION]
    );
    if (applied.rowCount !== 1) {
      checks.migrations = 'missing';
      return { ok: false, checks, error: 'migrations_not_applied' };
    }

    checks.migrations = 'ok';
    return { ok: true, checks };
  } catch {
    checks.migrations = 'unavailable';
    return { ok: false, checks, error: 'migrations_unavailable' };
  }
}
