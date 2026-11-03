import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { checkReadiness } from '../../src/db/readiness.js';

const { Client } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;

function assertSafeTestDatabase(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!/test/i.test(databaseName)) {
    throw new Error(
      'Refusing to run destructive integration tests: TEST_DATABASE_URL database name must contain "test".'
    );
  }
}

const describeDb = databaseUrl ? describe : describe.skip;

describeDb('PostgreSQL migrations and readiness', () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    assertSafeTestDatabase(databaseUrl);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.end();
  }, 20_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.end();
  }, 20_000);

  it('fails readiness before migrations are applied', async () => {
    const pool = createPool(databaseUrl!);
    const result = await checkReadiness(pool);
    await pool.end();

    expect(result.ok).toBe(false);
    expect(result.checks.migrations).not.toBe('ok');
  }, 20_000);

  it('applies migrations once and is idempotent on a second run', async () => {
    const first = await runMigrations(databaseUrl!);
    expect(first.applied).toEqual(['001_infrastructure.sql']);
    expect(first.skipped).toEqual([]);

    const second = await runMigrations(databaseUrl!);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['001_infrastructure.sql']);

    const client = new Client({ connectionString: databaseUrl! });
    await client.connect();
    const migrations = await client.query('SELECT version FROM schema_migrations');
    const metadata = await client.query(
      "SELECT value FROM system_metadata WHERE key = 'schema_version'"
    );
    await client.end();

    expect(migrations.rowCount).toBe(1);
    expect(metadata.rows[0]?.value).toBe('4b01');
  }, 20_000);

  it('reports ready when the database and migrations are available', async () => {
    const pool = createPool(databaseUrl!);
    const result = await checkReadiness(pool);
    await pool.end();

    expect(result).toEqual({
      ok: true,
      checks: { database: 'ok', migrations: 'ok' },
    });
  }, 20_000);

  it('persists an infrastructure record across a new connection', async () => {
    const key = `integration_probe_${Date.now()}`;
    const firstPool = createPool(databaseUrl!);
    await firstPool.query(
      'INSERT INTO system_metadata (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, 'persisted']
    );
    await firstPool.end();

    const secondPool = createPool(databaseUrl!);
    const result = await secondPool.query(
      'SELECT value FROM system_metadata WHERE key = $1',
      [key]
    );
    expect(result.rows[0]?.value).toBe('persisted');
    await secondPool.query('DELETE FROM system_metadata WHERE key = $1', [key]);
    await secondPool.end();
  }, 20_000);
});
