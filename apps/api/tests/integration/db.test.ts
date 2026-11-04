import pg from 'pg';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { checkReadiness } from '../../src/db/readiness.js';
import { assertSafeTestDatabase, type SafeTestDatabase } from '../support/testDatabaseSafety.js';

const { Client } = pg;

// Fail closed at module load if TEST_DATABASE_URL is present but unsafe.
// This happens before any Client connection or destructive SQL.
const safeDatabase: SafeTestDatabase | null = process.env.TEST_DATABASE_URL
  ? assertSafeTestDatabase(process.env.TEST_DATABASE_URL)
  : null;
const describeDb = safeDatabase ? describe : describe.skip;
const databaseUrl = () => safeDatabase!.databaseUrl;
const realMigrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

describeDb('PostgreSQL migrations and readiness', () => {
  beforeAll(async () => {
    if (!safeDatabase) return;
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.end();
  }, 20_000);

  afterAll(async () => {
    if (!safeDatabase) return;
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.end();
  }, 20_000);

  it('fails readiness before migrations are applied', async () => {
    const pool = createPool(databaseUrl());
    const result = await checkReadiness(pool);
    await pool.end();

    expect(result.ok).toBe(false);
    expect(result.checks.migrations).not.toBe('ok');
  }, 20_000);

  it('applies migrations once and is idempotent on a second run', async () => {
    const first = await runMigrations(databaseUrl());
    expect(first.applied).toEqual(['001_infrastructure.sql', '002_auth_rbac.sql']);
    expect(first.skipped).toEqual([]);

    const second = await runMigrations(databaseUrl());
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['001_infrastructure.sql', '002_auth_rbac.sql']);

    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    const migrations = await client.query(
      'SELECT version, checksum FROM schema_migrations ORDER BY version'
    );
    const metadata = await client.query(
      "SELECT value FROM system_metadata WHERE key = 'schema_version'"
    );
    await client.end();

    expect(migrations.rowCount).toBe(2);
    expect(migrations.rows[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.rows[0]?.value).toBe('4b02');
  }, 20_000);

  it('detects drift if an applied migration file is edited', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'aoking-migrations-'));
    try {
      await copyFile(
        join(realMigrationsDir, '001_infrastructure.sql'),
        join(tempDir, '001_infrastructure.sql')
      );
      await copyFile(
        join(realMigrationsDir, '002_auth_rbac.sql'),
        join(tempDir, '002_auth_rbac.sql')
      );
      const probe = join(tempDir, '999_checksum_probe.sql');
      await writeFile(probe, 'CREATE TABLE checksum_probe (id integer PRIMARY KEY);');
      const first = await runMigrations(databaseUrl(), tempDir);
      expect(first.applied).toEqual(['999_checksum_probe.sql']);

      await writeFile(
        probe,
        'CREATE TABLE checksum_probe (id integer PRIMARY KEY, note text);'
      );
      await expect(runMigrations(databaseUrl(), tempDir)).rejects.toThrow(/drift/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('reports ready when the database, migrations and expected version are available', async () => {
    const pool = createPool(databaseUrl());
    const result = await checkReadiness(pool);
    await pool.end();

    expect(result).toEqual({
      ok: true,
      checks: { database: 'ok', migrations: 'ok' },
    });
  }, 20_000);

  it('fails readiness when the expected schema_version does not match', async () => {
    const pool = createPool(databaseUrl());
    await pool.query("UPDATE system_metadata SET value = 'stale' WHERE key = 'schema_version'");
    const stale = await checkReadiness(pool);
    expect(stale.ok).toBe(false);
    expect(stale.checks.migrations).toBe('version_mismatch');
    await pool.query("UPDATE system_metadata SET value = '4b02' WHERE key = 'schema_version'");
    await pool.end();
  }, 20_000);

  it('persists an infrastructure record across a new connection', async () => {
    const key = `integration_probe_${Date.now()}`;
    const firstPool = createPool(databaseUrl());
    await firstPool.query(
      'INSERT INTO system_metadata (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, 'persisted']
    );
    await firstPool.end();

    const secondPool = createPool(databaseUrl());
    const result = await secondPool.query(
      'SELECT value FROM system_metadata WHERE key = $1',
      [key]
    );
    expect(result.rows[0]?.value).toBe('persisted');
    await secondPool.query('DELETE FROM system_metadata WHERE key = $1', [key]);
    await secondPool.end();
  }, 20_000);
});
