import 'dotenv/config';
import { loadEnv, loadMigrationDatabaseUrl } from '../config/env.js';
import { createPool } from './pool.js';

/**
 * Phase 4B-01 has no business schema yet, so this guarded seed only records a
 * development marker. Future business seeds must use the same production guard
 * and remain idempotent. Production deployments never run this script.
 */
async function main() {
  const env = loadEnv();
  if (env.nodeEnv === 'production') {
    throw new Error('Refusing to run development seed with NODE_ENV=production.');
  }
  if (process.env.SEED_DEV_DATA !== 'yes') {
    throw new Error('Set SEED_DEV_DATA=yes to run the development seed.');
  }

  const pool = createPool(loadMigrationDatabaseUrl());
  try {
    await pool.query(
      `INSERT INTO system_metadata (key, value)
       VALUES ('dev_seed_marker', '4b02-dev')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
    );
    console.log('Development seed marker recorded. No business data was inserted.');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Development seed failed.');
  process.exitCode = 1;
});
