import pg from 'pg';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { assertSafeTestDatabase, type SafeTestDatabase } from '../support/testDatabaseSafety.js';

const { Client } = pg;

const safeDatabase: SafeTestDatabase | null = process.env.TEST_DATABASE_URL
  ? assertSafeTestDatabase(process.env.TEST_DATABASE_URL)
  : null;
const describeDb = safeDatabase ? describe : describe.skip;
const databaseUrl = () => safeDatabase!.databaseUrl;
const realMigrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_ORDER_ID = '33333333-3333-4333-8333-333333333333';
const NEW_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const NOTIFICATION_ID = '55555555-5555-4555-8555-555555555555';

async function withClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Rehearses the real 006 -> 007 upgrade with historical data. Migration 007 is
 * additive: it must widen the order-number CHECK without rewriting or
 * reinterpreting existing ODYYMMDDNNNN orders, status history or outbox rows.
 */
describeDb('Phase 4B-05 order-number compatibility over existing data', () => {
  let preUpgradeDir: string;

  beforeAll(async () => {
    if (!safeDatabase) return;
    await withClient(client =>
      client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    );
    preUpgradeDir = await mkdtemp(join(tmpdir(), 'aoking-006-'));
    for (const file of [
      '001_infrastructure.sql',
      '002_auth_rbac.sql',
      '003_sales_write_scope.sql',
      '004_catalog_inventory.sql',
      '005_cart_orders.sql',
      '006_sales_reassignment.sql',
    ]) {
      await copyFile(join(realMigrationsDir, file), join(preUpgradeDir, file));
    }

    // Build a database that is exactly at 006, as it existed before 4B-05.
    const preUpgrade = await runMigrations(databaseUrl(), preUpgradeDir);
    expect(preUpgrade.applied).toHaveLength(6);

    await withClient(async client => {
      await client.query(
        `INSERT INTO customer_companies (id, customer_code, short_name, country_alpha3)
         VALUES ($1, 'C990001', 'Legacy Compatibility', 'USA')`,
        [COMPANY_ID]
      );
      await client.query(
        `INSERT INTO customer_users
           (id, company_id, username, account_letter, password_hash, must_change_password)
         VALUES ($1, $2, 'AK990001A', 'A', 'scrypt$legacy$fixture', false)`,
        [USER_ID, COMPANY_ID]
      );
      await client.query(
        `INSERT INTO orders
           (id, order_no, company_id, submitted_by_user_id, status, revision,
            shipping_method, destination_country_alpha3, expected_ship_date,
            shipping_requirements, pricing_mode, pricing_version,
            reference_total_cents, submitted_at, created_at, updated_at)
         VALUES ($1, 'OD2611100001', $2, $3, 'PENDING_CONFIRMATION', 1,
                 'Sea', 'USA', '2026-12-01', 'Legacy historical order',
                 'base_reference', 'legacy-v1', 420000,
                 '2026-11-10T23:30:00Z', '2026-11-10T23:30:00Z', '2026-11-10T23:30:00Z')`,
        [LEGACY_ORDER_ID, COMPANY_ID, USER_ID]
      );
      await client.query(
        `INSERT INTO order_status_history
           (id, order_id, event_type, from_status, to_status, actor_type, actor_label, details)
         VALUES ('66666666-6666-4666-8666-666666666666', $1, 'SUBMITTED', NULL,
                 'PENDING_CONFIRMATION', 'customer', 'AK990001A', '{"legacy":true}'::jsonb)`,
        [LEGACY_ORDER_ID]
      );
      await client.query(
        `INSERT INTO order_notifications
           (id, order_id, company_id, audience, event_type, title, message)
         VALUES ($1, $2, $3, 'customer', 'ORDER_SUBMITTED',
                 'Order submitted', 'Historical outbox row must survive 007')`,
        [NOTIFICATION_ID, LEGACY_ORDER_ID, COMPANY_ID]
      );
      await client.query(
        `INSERT INTO order_sequences (order_date, next_seq)
         VALUES ('2026-11-10', 2)`
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (!safeDatabase) return;
    if (preUpgradeDir) await rm(preUpgradeDir, { recursive: true, force: true });
    await withClient(client =>
      client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    );
  }, 30_000);

  it('applies 007 over the 006 schema without rewriting historical data', async () => {
    const upgrade = await runMigrations(databaseUrl());
    expect(upgrade.applied).toEqual(['007_order_confirmation.sql']);
    expect(upgrade.skipped).toEqual([
      '001_infrastructure.sql',
      '002_auth_rbac.sql',
      '003_sales_write_scope.sql',
      '004_catalog_inventory.sql',
      '005_cart_orders.sql',
      '006_sales_reassignment.sql',
    ]);

    await withClient(async client => {
      const order = await client.query(
        `SELECT order_no, status, revision, reference_total_cents::text AS total,
                to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS submitted_at
         FROM orders WHERE id = $1`,
        [LEGACY_ORDER_ID]
      );
      expect(order.rows[0]).toEqual({
        order_no: 'OD2611100001',
        status: 'PENDING_CONFIRMATION',
        revision: '1',
        total: '420000',
        submitted_at: '2026-11-10T23:30:00',
      });

      const history = await client.query(
        `SELECT event_type, from_status, to_status, details
         FROM order_status_history WHERE order_id = $1`,
        [LEGACY_ORDER_ID]
      );
      expect(history.rows[0]).toMatchObject({
        event_type: 'SUBMITTED',
        from_status: null,
        to_status: 'PENDING_CONFIRMATION',
        details: { legacy: true },
      });

      const outbox = await client.query(
        `SELECT title, message, status FROM order_notifications WHERE id = $1`,
        [NOTIFICATION_ID]
      );
      expect(outbox.rows[0]).toEqual({
        title: 'Order submitted',
        message: 'Historical outbox row must survive 007',
        status: 'pending',
      });

      const sequence = await client.query(
        `SELECT next_seq FROM order_sequences WHERE order_date = '2026-11-10'`
      );
      expect(sequence.rows[0].next_seq).toBe(2);
    });
  }, 30_000);

  it('accepts new-format numbers alongside legacy ones and rejects malformed numbers', async () => {
    await withClient(async client => {
      await client.query(
        `INSERT INTO orders
           (id, order_no, company_id, submitted_by_user_id, status, revision,
            shipping_method, destination_country_alpha3, expected_ship_date,
            shipping_requirements, pricing_mode, pricing_version,
            reference_total_cents)
         VALUES ($1, 'OD-261110-0001', $2, $3, 'PENDING_CONFIRMATION', 1,
                 'Sea', 'USA', '2026-12-01', '', 'base_reference', 'v1', 100000)`,
        [NEW_ORDER_ID, COMPANY_ID, USER_ID]
      );
      const both = await client.query(
        `SELECT order_no FROM orders WHERE id IN ($1, $2) ORDER BY order_no`,
        [LEGACY_ORDER_ID, NEW_ORDER_ID]
      );
      expect(both.rows.map(row => row.order_no)).toEqual([
        'OD-261110-0001',
        'OD2611100001',
      ]);

      await expect(
        client.query(
          `INSERT INTO orders
             (id, order_no, company_id, submitted_by_user_id, status, revision,
              shipping_method, destination_country_alpha3, expected_ship_date,
              pricing_mode, pricing_version, reference_total_cents)
           VALUES ('77777777-7777-4777-8777-777777777777', 'OD-2611-0001',
                   $1, $2, 'PENDING_CONFIRMATION', 1, 'Sea', 'USA',
                   '2026-12-01', 'base_reference', 'v1', 100000)`,
          [COMPANY_ID, USER_ID]
        )
      ).rejects.toMatchObject({ code: '23514' });
    });
  }, 30_000);

  it('is a no-op when 007 is applied a second time', async () => {
    const second = await runMigrations(databaseUrl());
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain('007_order_confirmation.sql');
  }, 30_000);
});
