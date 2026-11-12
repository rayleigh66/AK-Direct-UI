import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { AuthConfig } from '../../src/auth/types.js';
import { hashPassword } from '../../src/auth/password.js';
import { createPool } from '../../src/db/pool.js';
import { checkReadiness } from '../../src/db/readiness.js';
import { runMigrations } from '../../src/db/migrate.js';
import { assertSafeTestDatabase } from '../support/testDatabaseSafety.js';

const { Client, Pool } = pg;
const safeDatabase = process.env.TEST_DATABASE_URL
  ? assertSafeTestDatabase(process.env.TEST_DATABASE_URL)
  : null;
const describeDb = safeDatabase ? describe : describe.skip;
const databaseUrl = () => safeDatabase!.databaseUrl;

const PASSWORD = 'TestPass123!Strong';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const config: AuthConfig = {
  cookieSecure: false,
  customerSessionIdleHours: 24,
  customerSessionAbsoluteDays: 30,
  internalSessionIdleHours: 2,
  internalSessionAbsoluteHours: 12,
  loginMaxAttempts: 5,
  loginWindowMinutes: 15,
  loginLockMinutes: 15,
  trustProxy: false,
  orderNumberTimeZone: 'UTC',
};

type TestAgent = ReturnType<typeof request.agent>;
let pool: Pool;
let app: Express;
let mediaRoot = '';
let warehouseId = '';
let skuId = '';

async function resetSchema(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}

async function createInternal(name: string, email: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO internal_users
      (id, name, email, password_hash, must_change_password, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, 'active', now(), now())`,
    [id, name, email.toLowerCase(), await hashPassword(PASSWORD)]
  );
  await pool.query(
    "INSERT INTO internal_user_roles (internal_user_id, role_id) VALUES ($1, 'admin')",
    [id]
  );
  return id;
}

async function csrf(agent: TestAgent): Promise<string> {
  const response = await agent.get('/api/auth/csrf');
  expect(response.status).toBe(200);
  return response.body.csrfToken as string;
}

async function login(username: string): Promise<{ agent: TestAgent; csrf: string }> {
  const agent = request.agent(app);
  const token = await csrf(agent);
  const response = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username, password: PASSWORD });
  expect(response.status).toBe(200);
  return { agent, csrf: token };
}

function post(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.post(pathName).set('X-CSRF-Token', token).send(body as object);
}
function patch(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.patch(pathName).set('X-CSRF-Token', token).send(body as object);
}

function previewBody(
  key: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    idempotencyKey: key,
    sourceName: 'stock.csv',
    rows: [
      { rowNumber: 1, skuCode: 'P1-SKU', warehouseCode: 'WH-P1', onHand: 30, unsellable: 1 },
      { rowNumber: 2, skuCode: 'P1-SKU', warehouseCode: 'WH-P1', onHand: 31, unsellable: 1 },
    ],
    ...overrides,
  };
}

describeDb('inventory import idempotency and committed-result snapshot (P1)', () => {
  beforeAll(async () => {
    if (!safeDatabase) return;
    await resetSchema();
    await runMigrations(databaseUrl());
    pool = createPool(databaseUrl());
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'aoking-import-p1-'));
    app = createApp({
      checkReadiness: () => checkReadiness(pool),
      auth: { pool, config },
      mediaRoot,
    });
    await createInternal('Import Admin', 'import.admin@example.test');
    await createInternal('Import Admin Two', 'import.admin2@example.test');

    const admin = await login('import.admin@example.test');
    const warehouse = await post(
      admin.agent,
      '/api/admin/warehouses',
      { code: 'WH-P1', name: '导入仓', nameEn: 'Import Warehouse' },
      admin.csrf
    );
    expect(warehouse.status).toBe(201);
    warehouseId = warehouse.body.warehouse.id;

    const product = await post(
      admin.agent,
      '/api/admin/catalog/products',
      {
        brandId: 'brand-aoking',
        productCode: 'P1-PRODUCT',
        title: '导入测试',
        titleEn: 'Import Test',
        category: 'Business Backpacks',
      },
      admin.csrf
    );
    expect(product.status).toBe(201);
    const image = await admin.agent
      .post(`/api/admin/catalog/products/${product.body.product.id}/images`)
      .set('X-CSRF-Token', admin.csrf)
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(image.status).toBe(201);
    const sku = await post(
      admin.agent,
      `/api/admin/catalog/products/${product.body.product.id}/skus`,
      {
        skuCode: 'P1-SKU',
        colorName: '黑',
        colorNameEn: 'Black',
        colorHex: '#111111',
        basePriceCents: 1000,
        initialInventory: { warehouseId, onHand: 20, unsellable: 0 },
      },
      admin.csrf
    );
    expect(sku.status).toBe(201);
    skuId = sku.body.sku.id;
    expect(
      (await post(admin.agent, `/api/admin/catalog/products/${product.body.product.id}/publish`, {}, admin.csrf))
        .status
    ).toBe(200);
  }, 60_000);

  afterAll(async () => {
    if (!safeDatabase) return;
    await pool.end();
    await resetSchema();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  }, 30_000);

  it('binds an idempotency key to the actor and canonical payload', async () => {
    const admin = await login('import.admin@example.test');
    const key = randomUUID();
    const first = await post(admin.agent, '/api/admin/inventory/import/preview', previewBody(key), admin.csrf);
    expect(first.status).toBe(422); // duplicate row set below is deliberately invalid
    expect(first.body.error.code).toBe('duplicate_import_row');

    const valid = previewBody(key);
    (valid.rows as unknown[]).pop();
    const created = await post(admin.agent, '/api/admin/inventory/import/preview', valid, admin.csrf);
    expect(created.status).toBe(201);
    const batchId = created.body.preview.batchId;

    // Property order and surrounding whitespace do not change the canonical payload.
    const retried = await post(
      admin.agent,
      '/api/admin/inventory/import/preview',
      {
        rows: [
          {
            unsellable: 1,
            onHand: 30,
            warehouseCode: ' wh-p1 ',
            skuCode: ' p1-sku ',
            rowNumber: 1,
          },
        ],
        sourceName: '  stock.csv  ',
        idempotencyKey: key,
      },
      admin.csrf
    );
    expect(retried.status).toBe(201);
    expect(retried.body.preview.batchId).toBe(batchId);

    const digest = await pool.query<{ payload_digest: string | null }>(
      'SELECT payload_digest FROM inventory_import_batches WHERE id = $1',
      [batchId]
    );
    expect(digest.rows[0].payload_digest).toMatch(/^[a-f0-9]{64}$/);

    const different = await post(
      admin.agent,
      '/api/admin/inventory/import/preview',
      { ...valid, sourceName: 'other.csv' },
      admin.csrf
    );
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('idempotency_conflict');

    const otherActor = await login('import.admin2@example.test');
    const actorConflict = await post(
      otherActor.agent,
      '/api/admin/inventory/import/preview',
      valid,
      otherActor.csrf
    );
    expect(actorConflict.status).toBe(409);
    expect(actorConflict.body.error.code).toBe('idempotency_conflict');
    expect(actorConflict.body.preview).toBeUndefined();
  });

  it('returns the same batch for concurrent previews with the same key and payload', async () => {
    const admin = await login('import.admin@example.test');
    const key = randomUUID();
    const body = previewBody(key);
    (body.rows as unknown[]).pop();
    const [left, right] = await Promise.all([
      post(admin.agent, '/api/admin/inventory/import/preview', body, admin.csrf),
      post(admin.agent, '/api/admin/inventory/import/preview', body, admin.csrf),
    ]);
    expect([left.status, right.status]).toEqual([201, 201]);
    expect(left.body.preview.batchId).toBe(right.body.preview.batchId);
    const rows = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inventory_import_batches WHERE idempotency_key = $1',
      [key]
    );
    expect(rows.rows[0].count).toBe('1');
  });

  it('returns the immutable committed result after later inventory adjustments', async () => {
    const admin = await login('import.admin@example.test');
    const preview = await post(
      admin.agent,
      '/api/admin/inventory/import/preview',
      {
        idempotencyKey: randomUUID(),
        sourceName: 'commit.csv',
        rows: [{ rowNumber: 1, skuCode: 'P1-SKU', warehouseCode: 'WH-P1', onHand: 30, unsellable: 1 }],
      },
      admin.csrf
    );
    expect(preview.status).toBe(201);
    const batchId = preview.body.preview.batchId;

    const committed = await post(
      admin.agent,
      `/api/admin/inventory/import/${batchId}/commit`,
      {},
      admin.csrf
    );
    expect(committed.status).toBe(200);
    expect(committed.body.result.row).toBeUndefined();
    expect(committed.body.result.rows).toEqual([
      { skuCode: 'P1-SKU', warehouseCode: 'WH-P1', onHand: 30, unsellable: 1, version: 2 },
    ]);

    const balance = await pool.query<{ version: string }>(
      'SELECT version FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
      [skuId, warehouseId]
    );
    const adjusted = await patch(
      admin.agent,
      `/api/admin/inventory/${skuId}/${warehouseId}`,
      { onHand: 50, expectedVersion: Number(balance.rows[0].version), reason: 'after import' },
      admin.csrf
    );
    expect(adjusted.status).toBe(200);

    const repeated = await post(
      admin.agent,
      `/api/admin/inventory/import/${batchId}/commit`,
      {},
      admin.csrf
    );
    expect(repeated.status).toBe(200);
    expect(repeated.body.result.alreadyCommitted).toBe(true);
    expect(repeated.body.result.rows).toEqual([
      { skuCode: 'P1-SKU', warehouseCode: 'WH-P1', onHand: 30, unsellable: 1, version: 2 },
    ]);

    const stored = await pool.query(
      'SELECT 1 FROM inventory_import_commit_results WHERE batch_id = $1',
      [batchId]
    );
    expect(stored.rowCount).toBe(1);
    const movements = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inventory_movements WHERE import_batch_id = $1',
      [batchId]
    );
    expect(movements.rows[0].count).toBe('1');
    const reserved = await pool.query<{ reserved: number }>(
      'SELECT reserved FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
      [skuId, warehouseId]
    );
    expect(reserved.rows[0].reserved).toBe(0);
  });

  it('can return a result for a committed Phase 4B-03 batch without a stored snapshot', async () => {
    const adminIdRow = await pool.query<{ id: string }>(
      "SELECT id FROM internal_users WHERE email = 'import.admin@example.test'"
    );
    const batchId = randomUUID();
    await pool.query(
      `INSERT INTO inventory_import_batches
        (id, idempotency_key, payload_digest, source_name, status, row_count, created_by,
         created_at, committed_at)
       VALUES ($1, $2, NULL, 'legacy.csv', 'committed', 1, $3, now(), now())`,
      [batchId, `legacy-${batchId}`, adminIdRow.rows[0].id]
    );
    await pool.query(
      `INSERT INTO inventory_import_rows
        (batch_id, row_number, sku_id, warehouse_id, on_hand_new, unsellable_new,
         on_hand_before, unsellable_before, reserved_before, version_before)
       VALUES ($1, 1, $2, $3, 40, 0, 50, 0, 0, 3)`,
      [batchId, skuId, warehouseId]
    );

    const admin = await login('import.admin@example.test');
    const result = await post(
      admin.agent,
      `/api/admin/inventory/import/${batchId}/commit`,
      {},
      admin.csrf
    );
    expect(result.status).toBe(200);
    expect(result.body.result.alreadyCommitted).toBe(true);
    expect(result.body.result.rows).toEqual([
      { skuCode: 'P1-SKU', warehouseCode: 'WH-P1', onHand: 40, unsellable: 0, version: 4 },
    ]);
    expect(
      (await pool.query('SELECT 1 FROM inventory_import_commit_results WHERE batch_id = $1', [batchId]))
        .rowCount
    ).toBe(1);
  });
});
