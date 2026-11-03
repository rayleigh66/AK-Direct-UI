import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadEnv } from '../config/env.js';

const { Client } = pg;

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../migrations', import.meta.url)
);
const MIGRATION_LOCK_KEY = 4_242_000_1;
const MIGRATION_FILE = /^\d{3}_[a-zA-Z0-9_-]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  connectionString: string,
  migrationsDir = DEFAULT_MIGRATIONS_DIR
): Promise<MigrationResult> {
  const files = (await readdir(migrationsDir))
    .filter(file => MIGRATION_FILE.test(file))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migration files found in ${migrationsDir}.`);
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    application_name: 'aoking-direct-migrator',
  });
  await client.connect();

  let locked = false;
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    locked = true;

    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`
    );

    const existing = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    const appliedVersions = new Set(existing.rows.map(row => row.version));

    for (const file of files) {
      if (appliedVersions.has(file)) {
        skipped.push(file);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        appliedVersions.add(file);
      } catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'unknown database error';
        throw new Error(`Migration ${file} failed: ${message}`);
      }
    }

    return { applied, skipped };
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
    await client.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  (async () => {
    try {
      const env = loadEnv();
      const result = await runMigrations(env.databaseUrl);
      console.log(
        `Migrations complete: ${result.applied.length} applied, ${result.skipped.length} skipped.`
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Migration failed.');
      process.exitCode = 1;
    }
  })();
}
