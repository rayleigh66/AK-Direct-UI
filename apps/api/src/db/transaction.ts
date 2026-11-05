import type { PoolClient } from 'pg';
import type { DbPool } from './pool.js';

/** Runs a callback inside a single transaction and rolls back on any error. */
export async function withTransaction<T>(
  pool: DbPool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
