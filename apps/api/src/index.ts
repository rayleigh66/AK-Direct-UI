import 'dotenv/config';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import { checkReadiness } from './db/readiness.js';
import { runExpiryScan } from './orders/reservationService.js';

async function main() {
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);

  pool.query('SELECT 1').catch(() => {
    console.error('Database is not reachable at startup; readiness will report not_ready.');
  });

  const app = createApp({
    checkReadiness: () => checkReadiness(pool),
    auth: { pool, config: env },
    mediaRoot: env.mediaRoot,
  });
  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`AOKING Direct API listening on port ${env.port}.`);
  });

  // Recoverable, bounded expiry scan. Multiple API instances are safe because
  // the scan uses row locks, a unique reminder key and database time. Failures
  // are retried on the next tick; they never change stock by themselves.
  const expiryTimer = setInterval(() => {
    runExpiryScan(pool).catch(() => {
      // Readiness and the next scan remain the source of truth; never crash the
      // API because the outbox/scan is temporarily unavailable.
    });
  }, 60_000);
  expiryTimer.unref();

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down.`);
    clearInterval(expiryTimer);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(error => {
  console.error(
    'API failed to start:',
    error instanceof Error ? error.message : 'unknown configuration error'
  );
  process.exit(1);
});
