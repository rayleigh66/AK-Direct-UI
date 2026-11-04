import 'dotenv/config';
import { createHash } from 'node:crypto';
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

function checksumFor(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
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
        checksum text,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`
    );
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');

    const existing = await client.query<{ version: string; checksum: string | null }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version'
    );
    const appliedVersions = new Set(existing.rows.map(row => row.version));
    const appliedChecksums = new Map(
      existing.rows.map(row => [row.version, row.checksum])
    );

    for (const version of appliedVersions) {
      if (!files.includes(version)) {
        throw new Error(
          `Applied migration ${version} is missing from ${migrationsDir}; refusing to continue.`
        );
      }
    }

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = checksumFor(sql);

      if (appliedVersions.has(file)) {
        const storedChecksum = appliedChecksums.get(file);
        if (storedChecksum && storedChecksum !== checksum) {
          throw new Error(
            `Migration drift detected for ${file}; refusing to run mutated historical migrations.`
          );
        }
        if (!storedChecksum) {
          // Backfill legacy rows created before checksum tracking. New rows are
          // always written with a checksum below.
          await client.query(
            'UPDATE schema_migrations SET checksum = $1 WHERE version = $2 AND checksum IS NULL',
            [checksum, file]
          );
        }
        skipped.push(file);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        await client.query('COMMIT');
        applied.push(file);
        appliedVersions.add(file);
        appliedChecksums.set(file, checksum);
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
