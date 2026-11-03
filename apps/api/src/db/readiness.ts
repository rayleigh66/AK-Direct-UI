import type { DbPool } from './pool.js';

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
    const result = await pool.query(
      "SELECT 1 FROM system_metadata WHERE key = 'schema_version' LIMIT 1"
    );
    if (result.rowCount !== 1) {
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
