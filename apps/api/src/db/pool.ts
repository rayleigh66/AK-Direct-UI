import pg from 'pg';
import type { Pool as PgPool } from 'pg';

const { Pool } = pg;

export type DbPool = PgPool;

export function createPool(databaseUrl: string): DbPool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'aoking-direct-api',
  });

  // Idle clients can emit errors while the database is restarting. Without a
  // listener Node treats the event as uncaught and the API process exits.
  pool.on('error', () => {
    console.error('Idle PostgreSQL client error; the pool will recreate the connection.');
  });

  return pool;
}
