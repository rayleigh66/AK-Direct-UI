import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import pg from 'pg';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { AuthConfig } from '../../src/auth/types.js';
import { hashPassword } from '../../src/auth/password.js';
import { createPool } from '../../src/db/pool.js';
import { checkReadiness } from '../../src/db/readiness.js';
import { runMigrations } from '../../src/db/migrate.js';
import { provisionRuntimeRole } from '../../src/db/provision-runtime-role.js';
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

let adminId = '';
let sales1Id = '';
let sales2Id = '';
let companyAId = '';
let companyBId = '';
let customerAId = '';
let customerBId = '';
let seriesId = '';
let tagId = '';
let warehouseId = '';
let warehouseBId = '';
let productCounter = 0;

async function resetSchema(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}

async function createInternal(name: string, email: string, roles: string[]): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO internal_users
      (id, name, email, password_hash, must_change_password, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, 'active', now(), now())`,
    [id, name, email.toLowerCase(), await hashPassword(PASSWORD)]
  );
  for (const role of roles) {
    await pool.query(
      'INSERT INTO internal_user_roles (internal_user_id, role_id) VALUES ($1, $2)',
      [id, role]
    );
  }
  return id;
}

async function createCompanyWithCustomer(options: {
  code: string;
  name: string;
  assignedSalesUserId: string | null;
  username: string;
}): Promise<{ companyId: string; userId: string }> {
  const companyId = randomUUID();
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO customer_companies
      (id, customer_code, short_name, country_alpha3, assigned_sales_user_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'USA', $4, 'active', now(), now())`,
    [companyId, options.code, options.name, options.assignedSalesUserId]
  );
  await pool.query(
    `INSERT INTO customer_users
      (id, company_id, username, account_letter, password_hash, must_change_password, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'A', $4, false, 'active', now(), now())`,
    [userId, companyId, options.username, await hashPassword(PASSWORD)]
  );
  return { companyId, userId };
}

async function csrf(agent: TestAgent): Promise<string> {
  const response = await agent.get('/api/auth/csrf');
  expect(response.status).toBe(200);
  return response.body.csrfToken as string;
}

async function login(
  agent: TestAgent,
  username: string
): Promise<{ response: SupertestResponse; csrfToken: string }> {
  const csrfToken = await csrf(agent);
  const response = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', csrfToken)
    .send({ username, password: PASSWORD });
  return { response, csrfToken };
}

async function loggedInAgent(username: string, targetApp: Express = app): Promise<{ agent: TestAgent; csrfToken: string }> {
  const agent = request.agent(targetApp);
  const { response, csrfToken } = await login(agent, username);
  expect(response.status).toBe(200);
  return { agent, csrfToken };
}

let warehouseRuntimeCounter = 0;
async function withWarehouseRuntime(fn: (runtimeApp: Express, applicationName: string) => Promise<void>) {
  warehouseRuntimeCounter += 1;
  const role = `aoking_runtime_warehouse_${process.pid}_${warehouseRuntimeCounter}`;
  const password = 'WarehouseRuntimePass123!';
  await provisionRuntimeRole({ adminDatabaseUrl: databaseUrl(), runtimeUser: role, runtimePassword: password });
  const url = new URL(databaseUrl()); url.username = role; url.password = password;
  const applicationName = `warehouse-regression-${warehouseRuntimeCounter}`;
  const runtimePool = new Pool({ connectionString: url.toString(), application_name: applicationName, max: 10 });
  const runtimeApp = createApp({ checkReadiness: () => checkReadiness(runtimePool), auth: { pool: runtimePool, config }, mediaRoot });
  try { await fn(runtimeApp, applicationName); }
  finally {
    await runtimePool.end();
    await pool.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
  }
}
async function inventoryFacts(skuId: string, whId: string) {
  const result = await pool.query<{ balances: string; movements: string; audits: string }>(
    `SELECT
      (SELECT count(*) FROM inventory_balances WHERE sku_id=$1 AND warehouse_id=$2)::text AS balances,
      (SELECT count(*) FROM inventory_movements WHERE sku_id=$1 AND warehouse_id=$2)::text AS movements,
      (SELECT count(*) FROM audit_logs WHERE action='REGISTER_INVENTORY' AND target_id=$3)::text AS audits`,
    [skuId, whId, `${skuId}:${whId}`]
  );
  return result.rows[0];
}
async function waitForWarehouseCondition(check: () => Promise<boolean>) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Warehouse PostgreSQL scheduling barrier not reached');
}
async function gateWarehouseInsert(skuId: string) {
  const coordinator = await pool.connect();
  await coordinator.query('BEGIN');
  await coordinator.query('SELECT pg_advisory_xact_lock(15015, 1)');
  const pid = (await coordinator.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await pool.query(`CREATE FUNCTION warehouse_registration_gate_fn() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.sku_id = '${skuId}'::uuid THEN PERFORM pg_advisory_xact_lock(15015, 1); END IF; RETURN NEW; END $$;
    CREATE TRIGGER warehouse_registration_gate BEFORE INSERT ON inventory_balances
    FOR EACH ROW EXECUTE FUNCTION warehouse_registration_gate_fn();`);
  let released = false;
  const release = async () => { if (!released) { released = true; await coordinator.query('COMMIT'); coordinator.release(); } };
  return { pid, release, cleanup: async () => {
    await release();
    await pool.query('DROP TRIGGER warehouse_registration_gate ON inventory_balances; DROP FUNCTION warehouse_registration_gate_fn()');
  } };
}
async function warehouseBlockedPids(applicationName: string, blocker: number): Promise<number[]> {
  return (await pool.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
    WHERE application_name=$1 AND $2 = ANY(pg_blocking_pids(pid))`, [applicationName, blocker])).rows.map(row => row.pid);
}

function post(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.post(pathName).set('X-CSRF-Token', token).send(body as object);
}

function patch(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.patch(pathName).set('X-CSRF-Token', token).send(body as object);
}

function put(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.put(pathName).set('X-CSRF-Token', token).send(body as object);
}

function del(agent: TestAgent, pathName: string, token: string) {
  return agent.delete(pathName).set('X-CSRF-Token', token);
}

async function uploadImage(
  agent: TestAgent,
  token: string,
  productId: string,
  buffer: Buffer = PNG,
  mime = 'image/png'
) {
  return agent.post(`/api/admin/catalog/products/${productId}/images`)
    .set('X-CSRF-Token', token)
    .set('Content-Type', mime)
    .send(buffer);
}

async function createProduct(
  agent: TestAgent,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, any>> {
  productCounter += 1;
  const response = await post(
    agent,
    '/api/admin/catalog/products',
    {
      brandId: 'brand-aoking',
      productCode: `AKT-${String(productCounter).padStart(4, '0')}`,
      title: `测试商品 ${productCounter}`,
      titleEn: `Test Product ${productCounter}`,
      description: '测试描述',
      descriptionEn: 'Test description',
      category: 'Business Backpacks',
      material: 'Polyester',
      capacityOrSize: '20L',
      seriesId,
      tagIds: [tagId],
      ...overrides,
    },
    token
  );
  expect(response.status).toBe(201);
  return response.body.product;
}

async function createSku(
  agent: TestAgent,
  token: string,
  productId: string,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, any>> {
  productCounter += 1;
  const response = await post(
    agent,
    `/api/admin/catalog/products/${productId}/skus`,
    {
      skuCode: `AKT-SKU-${productCounter}`,
      colorName: '哑光黑',
      colorNameEn: 'Matte Black',
      colorHex: '#1c1c1e',
      basePriceCents: 3800,
      ...overrides,
    },
    token
  );
  expect(response.status).toBe(201);
  return response.body.sku;
}

describeDb('catalog, media and inventory persistence', () => {
  beforeAll(async () => {
    if (!safeDatabase) return;
    await resetSchema();
    await runMigrations(databaseUrl());
    pool = createPool(databaseUrl());
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'aoking-media-'));
    app = createApp({
      checkReadiness: () => checkReadiness(pool),
      auth: { pool, config },
      mediaRoot,
    });

    adminId = await createInternal('Catalog Admin', 'catalog.admin@example.test', ['admin']);
    sales1Id = await createInternal('Sales One', 'sales.one@example.test', ['sales']);
    sales2Id = await createInternal('Sales Two', 'sales.two@example.test', ['sales']);

    const a = await createCompanyWithCustomer({
      code: 'C000201',
      name: 'Granted Customer',
      assignedSalesUserId: sales1Id,
      username: 'AK000201A',
    });
    companyAId = a.companyId;
    customerAId = a.userId;
    const b = await createCompanyWithCustomer({
      code: 'C000202',
      name: 'No AOKING Grant',
      assignedSalesUserId: sales2Id,
      username: 'AK000202A',
    });
    companyBId = b.companyId;
    customerBId = b.userId;

    await pool.query("INSERT INTO brand_grants (company_id, brand_id) VALUES ($1, 'brand-aoking')", [
      companyAId,
    ]);
    await pool.query(
      `INSERT INTO brands (id, code, name, name_en, is_default_granted, active)
       VALUES ('brand-voyager', 'VOYAGER', 'VOYAGER', 'VOYAGER', false, true)
       ON CONFLICT (id) DO NOTHING`
    );
    await pool.query("INSERT INTO brand_grants (company_id, brand_id) VALUES ($1, 'brand-voyager')", [
      companyBId,
    ]);

    const admin = await loggedInAgent('catalog.admin@example.test');
    const series = await post(
      admin.agent,
      '/api/admin/catalog/series',
      { nameZh: '日常核心', nameEn: 'Everyday Core', sortOrder: 1 },
      admin.csrfToken
    );
    expect(series.status).toBe(201);
    seriesId = series.body.series.id;
    const tag = await post(
      admin.agent,
      '/api/admin/catalog/tags',
      { code: 'WATERPROOF', nameZh: '防水', nameEn: 'Waterproof', tone: 'blue', sortOrder: 1 },
      admin.csrfToken
    );
    expect(tag.status).toBe(201);
    tagId = tag.body.tag.id;
    const warehouse = await post(
      admin.agent,
      '/api/admin/warehouses',
      { code: 'WH-TEST-A', name: '测试仓 A', nameEn: 'Test Warehouse A' },
      admin.csrfToken
    );
    expect(warehouse.status).toBe(201);
    warehouseId = warehouse.body.warehouse.id;
    const warehouseB = await post(
      admin.agent,
      '/api/admin/warehouses',
      { code: 'WH-TEST-B', name: '测试仓 B', nameEn: 'Test Warehouse B' },
      admin.csrfToken
    );
    warehouseBId = warehouseB.body.warehouse.id;
  }, 60_000);

  afterAll(async () => {
    if (!safeDatabase) return;
    await pool.end();
    await resetSchema();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  }, 30_000);

  it('rejects duplicate taxonomy and warehouse codes and keeps stable ids', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    expect(
      (await post(admin.agent, '/api/admin/warehouses', { code: 'WH-TEST-A', name: 'dup', nameEn: 'dup' }, admin.csrfToken))
        .status
    ).toBe(409);
    const warehouses = await admin.agent.get('/api/admin/warehouses');
    expect(warehouses.status).toBe(200);
    expect(warehouses.body.warehouses.map((item: { code: string }) => item.code)).toEqual([
      'WH-TEST-A',
      'WH-TEST-B',
    ]);
    const series = await patch(
      admin.agent,
      `/api/admin/catalog/series/${seriesId}`,
      { nameEn: 'Everyday Core Updated' },
      admin.csrfToken
    );
    expect(series.status).toBe(200);
    expect(series.body.series.id).toBe(seriesId);
    expect(series.body.series.nameEn).toBe('Everyday Core Updated');
  });

  it('creates an unpublished product with a unique manual product code', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, {
      productCode: 'AKT-9001',
      titleEn: 'Draft Product',
    });
    expect(product.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(product.published).toBe(false);
    expect(product.seriesId).toBe(seriesId);
    expect(product.tagIds).toEqual([tagId]);

    const duplicate = await post(
      admin.agent,
      '/api/admin/catalog/products',
      {
        brandId: 'brand-aoking',
        productCode: 'AKT-9001',
        title: '重复',
        titleEn: 'Duplicate',
        category: 'Business Backpacks',
      },
      admin.csrfToken
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('duplicate_product_code');

    const fetched = await admin.agent.get(`/api/admin/catalog/products/${product.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.product.productCode).toBe('AKT-9001');
  });

  it('requires an explicit active warehouse for initial stock and keeps SKU ids stable', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken);
    const sku = await createSku(admin.agent, admin.csrfToken, product.id, {
      skuCode: 'AKT-INIT-1',
    });
    expect(sku.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (await pool.query('SELECT 1 FROM inventory_balances WHERE sku_id = $1', [sku.id])).rowCount
    ).toBe(0);

    const noWarehouse = await post(
      admin.agent,
      `/api/admin/catalog/products/${product.id}/skus`,
      {
        skuCode: 'AKT-INIT-2',
        colorName: '灰色',
        colorNameEn: 'Grey',
        colorHex: '#888888',
        basePriceCents: 3200,
        initialInventory: { warehouseId: randomUUID(), onHand: 5 },
      },
      admin.csrfToken
    );
    expect(noWarehouse.status).toBe(400);
    expect(
      (await pool.query("SELECT 1 FROM product_skus WHERE sku_code = 'AKT-INIT-2'")).rowCount
    ).toBe(0);

    const withStock = await post(
      admin.agent,
      `/api/admin/catalog/products/${product.id}/skus`,
      {
        skuCode: 'AKT-INIT-3',
        colorName: '蓝色',
        colorNameEn: 'Blue',
        colorHex: '#123456',
        basePriceCents: 4200,
        initialInventory: { warehouseId, onHand: 12, unsellable: 2 },
      },
      admin.csrfToken
    );
    expect(withStock.status).toBe(201);
    const balance = await pool.query<{ on_hand: number; reserved: number; unsellable: number }>(
      'SELECT on_hand, reserved, unsellable FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
      [withStock.body.sku.id, warehouseId]
    );
    expect(balance.rows[0]).toEqual({ on_hand: 12, reserved: 0, unsellable: 2 });
    const movement = await pool.query<{ movement_type: string; actor_id: string }>(
      'SELECT movement_type, actor_id FROM inventory_movements WHERE sku_id = $1',
      [withStock.body.sku.id]
    );
    expect(movement.rows[0]).toMatchObject({ movement_type: 'initial', actor_id: adminId });

    const edited = await patch(
      admin.agent,
      `/api/admin/catalog/skus/${withStock.body.sku.id}`,
      { colorNameEn: 'Deep Blue', basePriceCents: 4500 },
      admin.csrfToken
    );
    expect(edited.status).toBe(200);
    expect(edited.body.sku.id).toBe(withStock.body.sku.id);
    expect(edited.body.sku.basePriceCents).toBe(4500);
  });

  it('enforces publish prerequisites and image upload validation', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken);

    expect(
      (await post(admin.agent, `/api/admin/catalog/products/${product.id}/publish`, {}, admin.csrfToken))
        .body.error.code
    ).toBe('publish_requires_sku');

    await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-PUB-1' });
    expect(
      (await post(admin.agent, `/api/admin/catalog/products/${product.id}/publish`, {}, admin.csrfToken))
        .body.error.code
    ).toBe('publish_requires_image');

    const badUpload = await uploadImage(admin.agent, admin.csrfToken, product.id, Buffer.from('not an image'), 'image/png');
    expect(badUpload.status).toBe(415);

    const upload = await uploadImage(admin.agent, admin.csrfToken, product.id);
    expect(upload.status).toBe(201);
    expect(upload.body.image.isPrimary).toBe(true);
    expect(upload.body.image.url).toBe(`/api/media/${upload.body.image.id}`);

    const publish = await post(
      admin.agent,
      `/api/admin/catalog/products/${product.id}/publish`,
      {},
      admin.csrfToken
    );
    expect(publish.status).toBe(200);
    expect(publish.body.product.published).toBe(true);
    const unpublish = await post(
      admin.agent,
      `/api/admin/catalog/products/${product.id}/unpublish`,
      {},
      admin.csrfToken
    );
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.product.published).toBe(false);
  });

  it('serves media only to authorized customers for published products', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-MEDIA' });
    await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-MEDIA-SKU' });
    const upload = await uploadImage(admin.agent, admin.csrfToken, product.id);
    const imageId = upload.body.image.id as string;

    const customerA = await loggedInAgent('AK000201A');
    const customerB = await loggedInAgent('AK000202A');

    // Not published yet.
    expect((await customerA.agent.get(`/api/media/${imageId}`)).status).toBe(404);
    await post(admin.agent, `/api/admin/catalog/products/${product.id}/publish`, {}, admin.csrfToken);
    expect((await customerA.agent.get(`/api/media/${imageId}`)).status).toBe(200);
    expect((await customerB.agent.get(`/api/media/${imageId}`)).status).toBe(404);
    expect((await admin.agent.get(`/api/media/${imageId}`)).status).toBe(200);

    await post(admin.agent, `/api/admin/catalog/products/${product.id}/unpublish`, {}, admin.csrfToken);
    expect((await customerA.agent.get(`/api/media/${imageId}`)).status).toBe(404);
  });

  it('protects the last active SKU of a published product', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-LASTSKU' });
    const first = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-LASTSKU-1' });
    const second = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-LASTSKU-2' });
    await uploadImage(admin.agent, admin.csrfToken, product.id);
    expect(
      (await post(admin.agent, `/api/admin/catalog/products/${product.id}/publish`, {}, admin.csrfToken))
        .status
    ).toBe(200);

    expect(
      (await patch(admin.agent, `/api/admin/catalog/skus/${second.id}`, { sellableStatus: 'discontinued' }, admin.csrfToken))
        .status
    ).toBe(200);
    const blocked = await patch(
      admin.agent,
      `/api/admin/catalog/skus/${first.id}`,
      { sellableStatus: 'discontinued' },
      admin.csrfToken
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('last_active_sku');

    await post(admin.agent, `/api/admin/catalog/products/${product.id}/unpublish`, {}, admin.csrfToken);
    expect(
      (await patch(admin.agent, `/api/admin/catalog/skus/${first.id}`, { sellableStatus: 'discontinued' }, admin.csrfToken))
        .status
    ).toBe(200);
    const cannotPublish = await post(
      admin.agent,
      `/api/admin/catalog/products/${product.id}/publish`,
      {},
      admin.csrfToken
    );
    expect(cannotPublish.body.error.code).toBe('publish_requires_sku');
  });

  it('serialises concurrent discontinuations so a published product keeps an active SKU', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-RACE-SKU' });
    const first = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-RACE-SKU-1' });
    const second = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-RACE-SKU-2' });
    await uploadImage(admin.agent, admin.csrfToken, product.id);
    expect(
      (await post(admin.agent, `/api/admin/catalog/products/${product.id}/publish`, {}, admin.csrfToken))
        .status
    ).toBe(200);

    const [one, two] = await Promise.all([
      patch(
        admin.agent,
        `/api/admin/catalog/skus/${first.id}`,
        { sellableStatus: 'discontinued' },
        admin.csrfToken
      ),
      patch(
        admin.agent,
        `/api/admin/catalog/skus/${second.id}`,
        { sellableStatus: 'discontinued' },
        admin.csrfToken
      ),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const blocked = one.status === 409 ? one : two;
    expect(blocked.body.error.code).toBe('last_active_sku');

    const skus = await pool.query<{ id: string; sellable_status: string }>(
      'SELECT id, sellable_status FROM product_skus WHERE product_id = $1 ORDER BY id',
      [product.id]
    );
    const active = skus.rows.filter(row => row.sellable_status === 'active');
    expect(active).toHaveLength(1);
    const loserId = one.status === 409 ? first.id : second.id;
    expect(skus.rows.find(row => row.id === loserId)?.sellable_status).toBe('active');

    const published = await pool.query<{ published: boolean }>(
      'SELECT published FROM products WHERE id = $1',
      [product.id]
    );
    expect(published.rows[0].published).toBe(true);

    const audits = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
       WHERE action = 'UPDATE_SKU' AND target_id = ANY($1::text[])`,
      [[first.id, second.id]]
    );
    expect(Number(audits.rows[0].count)).toBe(1);
  });

  it('keeps the invariant when publishing races the last-SKU discontinuation', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    for (let round = 0; round < 5; round++) {
      const product = await createProduct(admin.agent, admin.csrfToken, {
        productCode: `AKT-PUBRACE-${round}`,
      });
      const sku = await createSku(admin.agent, admin.csrfToken, product.id, {
        skuCode: `AKT-PUBRACE-${round}-SKU`,
      });
      await uploadImage(admin.agent, admin.csrfToken, product.id);

      const [publish, discontinue] = await Promise.all([
        post(admin.agent, `/api/admin/catalog/products/${product.id}/publish`, {}, admin.csrfToken),
        patch(
          admin.agent,
          `/api/admin/catalog/skus/${sku.id}`,
          { sellableStatus: 'discontinued' },
          admin.csrfToken
        ),
      ]);
      expect([publish.status, discontinue.status].sort()).toEqual([200, 409]);

      const state = await pool.query<{ published: boolean; active_count: string }>(
        `SELECT p.published,
                (SELECT count(*)::text FROM product_skus s
                 WHERE s.product_id = p.id AND s.sellable_status = 'active') AS active_count
         FROM products p WHERE p.id = $1`,
        [product.id]
      );
      if (state.rows[0].published) {
        expect(Number(state.rows[0].active_count)).toBeGreaterThanOrEqual(1);
      } else {
        expect(Number(state.rows[0].active_count)).toBe(0);
      }
      if (publish.status === 200) {
        expect(state.rows[0].published).toBe(true);
        expect(discontinue.body.error.code).toBe('last_active_sku');
      } else {
        expect(state.rows[0].published).toBe(false);
        expect(publish.body.error.code).toBe('publish_requires_sku');
      }

      const publishAudits = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'PUBLISH_PRODUCT' AND target_id = $1",
        [product.id]
      );
      const skuAudits = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'UPDATE_SKU' AND target_id = $1",
        [sku.id]
      );
      expect(Number(publishAudits.rows[0].count)).toBe(publish.status === 200 ? 1 : 0);
      expect(Number(skuAudits.rows[0].count)).toBe(discontinue.status === 200 ? 1 : 0);
    }
  });

  it('manages image ordering, primary selection and removal rules', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-IMAGES' });
    await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-IMAGES-SKU' });
    const first = (await uploadImage(admin.agent, admin.csrfToken, product.id)).body.image;
    const second = (await uploadImage(admin.agent, admin.csrfToken, product.id)).body.image;

    const reorder = await patch(
      admin.agent,
      `/api/admin/catalog/products/${product.id}/images/order`,
      { imageIds: [second.id, first.id] },
      admin.csrfToken
    );
    expect(reorder.status).toBe(200);
    expect(reorder.body.images.map((image: { id: string }) => image.id)).toEqual([second.id, first.id]);

    expect(
      (await put(
        admin.agent,
        `/api/admin/catalog/products/${product.id}/images/${second.id}/primary`,
        {},
        admin.csrfToken
      )).status
    ).toBe(200);
    expect(
      (await del(admin.agent, `/api/admin/catalog/products/${product.id}/images/${first.id}`, admin.csrfToken))
        .status
    ).toBe(200);
    const removePrimary = await del(
      admin.agent,
      `/api/admin/catalog/products/${product.id}/images/${second.id}`,
      admin.csrfToken
    );
    expect(removePrimary.status).toBe(409);
    expect(removePrimary.body.error.code).toBe('primary_image_required');
  });

  it('has no physical deletion for products, SKUs, series or tags', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-NODELETE' });
    const sku = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-NODELETE-SKU' });
    expect((await del(admin.agent, `/api/admin/catalog/products/${product.id}`, admin.csrfToken)).status).toBe(404);
    expect((await del(admin.agent, `/api/admin/catalog/skus/${sku.id}`, admin.csrfToken)).status).toBe(404);
    expect((await del(admin.agent, `/api/admin/catalog/series/${seriesId}`, admin.csrfToken)).status).toBe(404);
    expect((await del(admin.agent, `/api/admin/catalog/tags/${tagId}`, admin.csrfToken)).status).toBe(404);

    const deactivated = await patch(
      admin.agent,
      `/api/admin/catalog/series/${seriesId}`,
      { active: false },
      admin.csrfToken
    );
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.series.productCount).toBeGreaterThan(0);
    const productAfter = await admin.agent.get(`/api/admin/catalog/products/${product.id}`);
    expect(productAfter.body.product.seriesId).toBe(seriesId);
    await patch(admin.agent, `/api/admin/catalog/series/${seriesId}`, { active: true }, admin.csrfToken);
  });

  it('returns a customer-safe catalogue with prices, stock and filters', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-CUSTOMER' });
    const sku = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-CUSTOMER-SKU' });
    await uploadImage(admin.agent, admin.csrfToken, product.id);
    await post(admin.agent, `/api/admin/catalog/products/${product.id}/publish`, {}, admin.csrfToken);
    await post(
      admin.agent,
      '/api/admin/inventory/register',
      { skuId: sku.id, warehouseId, onHand: 20, unsellable: 5, reason: 'initial' },
      admin.csrfToken
    );

    const customerA = await loggedInAgent('AK000201A');
    const customerB = await loggedInAgent('AK000202A');

    const listA = await customerA.agent.get('/api/catalog/products');
    expect(listA.status).toBe(200);
    const found = listA.body.products.find((item: { id: string }) => item.id === product.id);
    expect(found).toBeTruthy();
    expect(found.skus[0]).toMatchObject({ id: sku.id, basePriceCents: 3800, available: 15 });
    expect(found.skus[0].imageId).toBeNull();
    expect(JSON.stringify(listA.body)).not.toContain('createdBy');

    const filtered = await customerA.agent.get(`/api/catalog/products?tagId=${tagId}&brandId=brand-aoking`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.products.some((item: { id: string }) => item.id === product.id)).toBe(true);

    const listB = await customerB.agent.get('/api/catalog/products');
    expect(listB.status).toBe(200);
    expect(listB.body.products.some((item: { id: string }) => item.id === product.id)).toBe(false);

    const brandsB = await customerB.agent.get('/api/catalog/brands');
    expect(brandsB.body.brands.map((brand: { id: string }) => brand.id)).toEqual(['brand-voyager']);

    await post(admin.agent, `/api/admin/catalog/products/${product.id}/unpublish`, {}, admin.csrfToken);
    const afterUnpublish = await customerA.agent.get('/api/catalog/products');
    expect(afterUnpublish.body.products.some((item: { id: string }) => item.id === product.id)).toBe(false);
    expect((await customerA.agent.get(`/api/catalog/products/${product.id}`)).status).toBe(404);
  });

  it('blocks customers and sales from privileged writes', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-RBAC' });
    const sku = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-RBAC-SKU' });
    await post(
      admin.agent,
      '/api/admin/inventory/register',
      { skuId: sku.id, warehouseId, onHand: 3, reason: 'initial' },
      admin.csrfToken
    );

    const customer = await loggedInAgent('AK000201A');
    const sales = await loggedInAgent('sales.one@example.test');

    expect(
      (await post(customer.agent, '/api/admin/catalog/products', { productCode: 'X' }, customer.csrfToken)).status
    ).toBe(403);
    expect(
      (await post(sales.agent, '/api/admin/catalog/products', { productCode: 'X' }, sales.csrfToken)).status
    ).toBe(403);
    expect(
      (
        await post(
          sales.agent,
          '/api/admin/inventory/register',
          { skuId: sku.id, warehouseId, onHand: 1, reason: 'x' },
          sales.csrfToken
        )
      ).status
    ).toBe(403);
    expect(
      (
        await patch(
          sales.agent,
          `/api/admin/inventory/${sku.id}/${warehouseId}`,
          { onHand: 9, expectedVersion: 1, reason: 'sales attempt' },
          sales.csrfToken
        )
      ).status
    ).toBe(403);
    expect((await customer.agent.get('/api/sales/inventory')).status).toBe(403);
    expect((await customer.agent.get('/api/admin/inventory')).status).toBe(403);
    expect((await sales.agent.get('/api/sales/inventory')).status).toBe(200);
    expect((await sales.agent.get('/api/admin/inventory')).status).toBe(403);

    // Missing CSRF must be rejected before any RBAC or write.
    expect(
      (
        await sales.agent
          .post('/api/admin/catalog/products')
          .send({ productCode: 'NOCSRF' })
      ).status
    ).toBe(403);
  });

  it('adjusts inventory with version checks and never changes reserved stock', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-ADJUST' });
    const sku = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-ADJUST-SKU' });
    const registered = await post(
      admin.agent,
      '/api/admin/inventory/register',
      { skuId: sku.id, warehouseId, onHand: 10, unsellable: 1, reason: 'initial' },
      admin.csrfToken
    );
    expect(registered.status).toBe(201);
    expect(registered.body.inventory).toMatchObject({ onHand: 10, reserved: 0, unsellable: 1, available: 9 });

    expect(
      (
        await post(
          admin.agent,
          '/api/admin/inventory/register',
          { skuId: sku.id, warehouseId, onHand: 5, reason: 'duplicate' },
          admin.csrfToken
        )
      ).status
    ).toBe(409);

    const adjusted = await patch(
      admin.agent,
      `/api/admin/inventory/${sku.id}/${warehouseId}`,
      { onHand: 15, unsellable: 2, expectedVersion: 1, reason: 'count correction' },
      admin.csrfToken
    );
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.inventory).toMatchObject({
      onHand: 15,
      reserved: 0,
      unsellable: 2,
      available: 13,
      version: 2,
    });

    const stale = await patch(
      admin.agent,
      `/api/admin/inventory/${sku.id}/${warehouseId}`,
      { onHand: 99, expectedVersion: 1, reason: 'stale' },
      admin.csrfToken
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');

    const negative = await patch(
      admin.agent,
      `/api/admin/inventory/${sku.id}/${warehouseId}`,
      { unsellable: 100, expectedVersion: 2, reason: 'invalid' },
      admin.csrfToken
    );
    expect(negative.status).toBe(422);

    const row = await pool.query<{ on_hand: number; reserved: number; unsellable: number; version: string }>(
      'SELECT on_hand, reserved, unsellable, version FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
      [sku.id, warehouseId]
    );
    expect(row.rows[0]).toMatchObject({ on_hand: 15, reserved: 0, unsellable: 2 });
    expect(Number(row.rows[0].version)).toBe(2);

    // A caller cannot smuggle reserved stock through the API body.
    await patch(
      admin.agent,
      `/api/admin/inventory/${sku.id}/${warehouseId}`,
      { onHand: 16, expectedVersion: 2, reason: 'reserved attempt', reserved: 7 },
      admin.csrfToken
    );
    const after = await pool.query<{ reserved: number }>(
      'SELECT reserved FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
      [sku.id, warehouseId]
    );
    expect(after.rows[0].reserved).toBe(0);

    const audit = await admin.agent.get('/api/admin/audit-logs?limit=100');
    expect(audit.body.logs.some((log: { action: string }) => log.action === 'ADJUST_INVENTORY')).toBe(true);
  });

  it('prevents lost updates when two adjustments race on the same version', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-RACE' });
    const sku = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-RACE-SKU' });
    await post(
      admin.agent,
      '/api/admin/inventory/register',
      { skuId: sku.id, warehouseId, onHand: 10, reason: 'initial' },
      admin.csrfToken
    );

    const [first, second] = await Promise.all([
      patch(
        admin.agent,
        `/api/admin/inventory/${sku.id}/${warehouseId}`,
        { onHand: 20, expectedVersion: 1, reason: 'race a' },
        admin.csrfToken
      ),
      patch(
        admin.agent,
        `/api/admin/inventory/${sku.id}/${warehouseId}`,
        { onHand: 30, expectedVersion: 1, reason: 'race b' },
        admin.csrfToken
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const row = await pool.query<{ on_hand: number; version: string }>(
      'SELECT on_hand, version FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
      [sku.id, warehouseId]
    );
    expect([20, 30]).toContain(row.rows[0].on_hand);
    expect(Number(row.rows[0].version)).toBe(2);
    const movements = await pool.query(
      "SELECT 1 FROM inventory_movements WHERE sku_id = $1 AND movement_type = 'adjustment'",
      [sku.id]
    );
    expect(movements.rowCount).toBe(1);
  });

  it('previews and commits imports atomically with an idempotent confirmation', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-IMPORT' });
    const sku1 = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-IMPORT-1' });
    const sku2 = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-IMPORT-2' });
    for (const sku of [sku1, sku2]) {
      await post(
        admin.agent,
        '/api/admin/inventory/register',
        { skuId: sku.id, warehouseId, onHand: 5, unsellable: 0, reason: 'initial' },
        admin.csrfToken
      );
    }

    const key = randomUUID();
    const preview = await post(
      admin.agent,
      '/api/admin/inventory/import/preview',
      {
        idempotencyKey: key,
        sourceName: 'stock.csv',
        rows: [
          { rowNumber: 1, skuCode: 'AKT-IMPORT-1', warehouseCode: 'WH-TEST-A', onHand: 8, unsellable: 1 },
          { rowNumber: 2, skuCode: 'AKT-IMPORT-2', warehouseCode: 'WH-TEST-A', onHand: 4, unsellable: 2 },
        ],
      },
      admin.csrfToken
    );
    expect(preview.status).toBe(201);
    expect(preview.body.preview.rows[0]).toMatchObject({
      onHandBefore: 5,
      onHandNew: 8,
      unsellableBefore: 0,
      unsellableNew: 1,
      reserved: 0,
      versionBefore: 1,
    });

    // A retry with the same actor and canonical payload is safe; the key is now
    // bound to that payload (Phase 4B-04 P1-A).
    const repeatedPreview = await post(
      admin.agent,
      '/api/admin/inventory/import/preview',
      {
        idempotencyKey: key,
        sourceName: 'stock.csv',
        rows: [
          { rowNumber: 2, skuCode: 'AKT-IMPORT-2', warehouseCode: 'WH-TEST-A', onHand: 4, unsellable: 2 },
          { rowNumber: 1, skuCode: 'AKT-IMPORT-1', warehouseCode: 'WH-TEST-A', onHand: 8, unsellable: 1 },
        ],
      },
      admin.csrfToken
    );
    expect(repeatedPreview.status).toBe(201);
    expect(repeatedPreview.body.preview.batchId).toBe(preview.body.preview.batchId);

    const commit = await post(
      admin.agent,
      `/api/admin/inventory/import/${preview.body.preview.batchId}/commit`,
      {},
      admin.csrfToken
    );
    expect(commit.status).toBe(200);
    expect(commit.body.result).toMatchObject({ alreadyCommitted: false });
    expect(commit.body.result.rows).toHaveLength(2);

    const balances = await pool.query<{ sku_id: string; on_hand: number; unsellable: number; version: string }>(
      'SELECT sku_id, on_hand, unsellable, version FROM inventory_balances WHERE sku_id = ANY($1::uuid[]) ORDER BY sku_id',
      [[sku1.id, sku2.id]]
    );
    const balanceBySku = new Map(
      balances.rows.map(row => [row.sku_id, [row.on_hand, row.unsellable, Number(row.version)]])
    );
    expect(balanceBySku.get(sku1.id)).toEqual([8, 1, 2]);
    expect(balanceBySku.get(sku2.id)).toEqual([4, 2, 2]);

    const movementsBefore = await pool.query(
      'SELECT 1 FROM inventory_movements WHERE import_batch_id = $1',
      [preview.body.preview.batchId]
    );
    expect(movementsBefore.rowCount).toBe(2);

    const again = await post(
      admin.agent,
      `/api/admin/inventory/import/${preview.body.preview.batchId}/commit`,
      {},
      admin.csrfToken
    );
    expect(again.status).toBe(200);
    expect(again.body.result.alreadyCommitted).toBe(true);
    const movementsAfter = await pool.query(
      'SELECT 1 FROM inventory_movements WHERE import_batch_id = $1',
      [preview.body.preview.batchId]
    );
    expect(movementsAfter.rowCount).toBe(2);

    const audit = await admin.agent.get('/api/admin/audit-logs?limit=100');
    expect(audit.body.logs.some((log: { action: string }) => log.action === 'IMPORT_INVENTORY')).toBe(true);
  });

  it('rejects a stale preview without applying any row', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-STALE' });
    const sku1 = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-STALE-1' });
    const sku2 = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-STALE-2' });
    for (const sku of [sku1, sku2]) {
      await post(
        admin.agent,
        '/api/admin/inventory/register',
        { skuId: sku.id, warehouseId, onHand: 5, reason: 'initial' },
        admin.csrfToken
      );
    }
    const preview = await post(
      admin.agent,
      '/api/admin/inventory/import/preview',
      {
        idempotencyKey: randomUUID(),
        rows: [
          { rowNumber: 1, skuCode: 'AKT-STALE-1', warehouseCode: 'WH-TEST-A', onHand: 9, unsellable: 0 },
          { rowNumber: 2, skuCode: 'AKT-STALE-2', warehouseCode: 'WH-TEST-A', onHand: 9, unsellable: 0 },
        ],
      },
      admin.csrfToken
    );
    expect(preview.status).toBe(201);

    await patch(
      admin.agent,
      `/api/admin/inventory/${sku1.id}/${warehouseId}`,
      { onHand: 7, expectedVersion: 1, reason: 'changed after preview' },
      admin.csrfToken
    );

    const commit = await post(
      admin.agent,
      `/api/admin/inventory/import/${preview.body.preview.batchId}/commit`,
      {},
      admin.csrfToken
    );
    expect(commit.status).toBe(409);
    expect(commit.body.error.code).toBe('stale_preview');

    const rows = await pool.query<{ sku_id: string; on_hand: number }>(
      'SELECT sku_id, on_hand FROM inventory_balances WHERE sku_id = ANY($1::uuid[]) ORDER BY sku_id',
      [[sku1.id, sku2.id]]
    );
    const bySku = new Map(rows.rows.map(row => [row.sku_id, row.on_hand]));
    expect(bySku.get(sku1.id)).toBe(7);
    expect(bySku.get(sku2.id)).toBe(5);
    const batch = await pool.query<{ status: string }>(
      'SELECT status FROM inventory_import_batches WHERE id = $1',
      [preview.body.preview.batchId]
    );
    expect(batch.rows[0].status).toBe('previewed');
  });

  it('rejects an import batch containing any invalid row', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-BADIMPORT' });
    const sku = await createSku(admin.agent, admin.csrfToken, product.id, { skuCode: 'AKT-BADIMPORT-1' });
    await post(
      admin.agent,
      '/api/admin/inventory/register',
      { skuId: sku.id, warehouseId, onHand: 5, reason: 'initial' },
      admin.csrfToken
    );

    const auditBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'PREVIEW_INVENTORY_IMPORT'"
    );
    const batchesBefore = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inventory_import_batches'
    );
    const invalidCases = [
      [
        { rowNumber: 1, skuCode: 'AKT-BADIMPORT-1', warehouseCode: 'WH-TEST-A', onHand: 6, unsellable: 0 },
        { rowNumber: 2, skuCode: 'MISSING-SKU', warehouseCode: 'WH-TEST-A', onHand: 6, unsellable: 0 },
      ],
      [
        { rowNumber: 1, skuCode: 'AKT-BADIMPORT-1', warehouseCode: 'WH-TEST-A', onHand: 6, unsellable: 0 },
        { rowNumber: 2, skuCode: 'AKT-BADIMPORT-1', warehouseCode: 'WH-TEST-A', onHand: 7, unsellable: 0 },
      ],
      [{ rowNumber: 1, skuCode: 'AKT-BADIMPORT-1', warehouseCode: 'WH-TEST-A', onHand: 3, unsellable: 4 }],
      [{ rowNumber: 1, skuCode: 'AKT-BADIMPORT-1', warehouseCode: 'WH-TEST-A', onHand: -1, unsellable: 0 }],
    ];
    for (const rows of invalidCases) {
      const response = await post(
        admin.agent,
        '/api/admin/inventory/import/preview',
        { idempotencyKey: randomUUID(), rows },
        admin.csrfToken
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const auditAfter = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'PREVIEW_INVENTORY_IMPORT'"
    );
    expect(auditAfter.rows[0].count).toBe(auditBefore.rows[0].count);
    const balance = await pool.query<{ on_hand: number }>(
      'SELECT on_hand FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
      [sku.id, warehouseId]
    );
    expect(balance.rows[0].on_hand).toBe(5);
    const batches = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inventory_import_batches'
    );
    expect(batches.rows[0].count).toBe(batchesBefore.rows[0].count);
  });

  it('rejects a SKU image that belongs to another product', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const first = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-SKUIMG-1' });
    const second = await createProduct(admin.agent, admin.csrfToken, { productCode: 'AKT-SKUIMG-2' });
    const foreignImage = (await uploadImage(admin.agent, admin.csrfToken, second.id)).body.image;
    const response = await post(
      admin.agent,
      `/api/admin/catalog/products/${first.id}/skus`,
      {
        skuCode: 'AKT-SKUIMG-SKU',
        colorName: '黑',
        colorNameEn: 'Black',
        colorHex: '#000000',
        basePriceCents: 1000,
        imageId: foreignImage.id,
      },
      admin.csrfToken
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_sku_image');
  });

  it('warehouse registration: concurrent first inserts return 201 and 409 with one initial fact', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken);
    const sku = await createSku(admin.agent, admin.csrfToken, product.id);
    await withWarehouseRuntime(async (runtimeApp, applicationName) => {
      const a = await loggedInAgent('catalog.admin@example.test', runtimeApp);
      const b = await loggedInAgent('catalog.admin@example.test', runtimeApp);
      const gate = await gateWarehouseInsert(sku.id);
      let requests: Array<Promise<SupertestResponse>> = [];
      try {
        requests = [a, b].map((actor, index) => post(actor.agent, '/api/admin/inventory/register', {
          skuId: sku.id, warehouseId, onHand: index ? 22 : 11, reason: `First count ${index}`,
        }, actor.csrfToken).then(response => response));
        await waitForWarehouseCondition(async () => (await warehouseBlockedPids(applicationName, gate.pid)).length === 2);
        await gate.release();
        const results = await Promise.all(requests);
        expect(results.map(row => row.status).sort()).toEqual([201, 409]);
        expect(results.find(row => row.status === 409)?.body.error.code).toBe('inventory_exists');
        expect(await inventoryFacts(sku.id, warehouseId)).toEqual({ balances: '1', movements: '1', audits: '1' });
        const movement = await pool.query<{ on_hand_before: number; on_hand_after: number; delta_on_hand: number }>(
          'SELECT on_hand_before, on_hand_after, delta_on_hand FROM inventory_movements WHERE sku_id=$1 AND warehouse_id=$2', [sku.id, warehouseId]
        );
        expect(movement.rows[0].on_hand_before).toBe(0);
        expect([11, 22]).toContain(movement.rows[0].on_hand_after);
        expect(movement.rows[0].delta_on_hand).toBe(movement.rows[0].on_hand_after);
        const winnerIndex = results.findIndex(row => row.status === 201);
        const audit = await pool.query('SELECT details FROM audit_logs WHERE action=$1 AND target_id=$2', ['REGISTER_INVENTORY', `${sku.id}:${warehouseId}`]);
        expect(audit.rows[0].details).toMatchObject({ skuCode: sku.skuCode ?? sku.sku_code, onHand: winnerIndex ? 22 : 11, unsellable: 0, reason: `First count ${winnerIndex}` });
      } finally { await gate.release(); await Promise.allSettled(requests); await gate.cleanup(); }
    });
  });

  it('warehouse registration: deactivation waits for a validated registration transaction', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken);
    const sku = await createSku(admin.agent, admin.csrfToken, product.id);
    const wh = await post(admin.agent, '/api/admin/warehouses', { code: 'WH-CONCURRENT', name: '并发仓', nameEn: 'Concurrent warehouse' }, admin.csrfToken);
    expect(wh.status).toBe(201);
    const whId = wh.body.warehouse.id as string;
    await withWarehouseRuntime(async (runtimeApp, applicationName) => {
      const a = await loggedInAgent('catalog.admin@example.test', runtimeApp);
      const b = await loggedInAgent('catalog.admin@example.test', runtimeApp);
      const gate = await gateWarehouseInsert(sku.id);
      let registration: Promise<SupertestResponse> | undefined;
      let deactivation: Promise<SupertestResponse> | undefined;
      try {
        registration = post(a.agent, '/api/admin/inventory/register', {
          skuId: sku.id, warehouseId: whId, onHand: 12, reason: 'Explicit initial count',
        }, a.csrfToken).then(response => response);
        let firstPid = 0;
        await waitForWarehouseCondition(async () => {
          firstPid = (await warehouseBlockedPids(applicationName, gate.pid))[0] ?? 0; return firstPid > 0;
        });
        let deactivated = false;
        deactivation = patch(b.agent, `/api/admin/warehouses/${whId}`, { active: false }, b.csrfToken)
          .then(response => { deactivated = true; return response; });
        await waitForWarehouseCondition(async () => deactivated || (await warehouseBlockedPids(applicationName, firstPid)).length > 0);
        const deactivatedBeforeRegistrationRelease = deactivated;
        await gate.release();
        const [registered, disabled] = await Promise.all([registration, deactivation]);
        expect({ deactivatedBeforeRegistrationRelease, statuses: [registered.status, disabled.status] })
          .toEqual({ deactivatedBeforeRegistrationRelease: false, statuses: [201, 200] });
        expect(await inventoryFacts(sku.id, whId)).toEqual({ balances: '1', movements: '1', audits: '1' });
        expect((await pool.query('SELECT active FROM warehouses WHERE id=$1', [whId])).rows[0].active).toBe(false);
      } finally { await gate.release(); await Promise.allSettled([registration, deactivation].filter(Boolean)); await gate.cleanup(); }
    });
  });

  it('warehouse registration: an already-inactive warehouse rejects new stock without facts', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken);
    const sku = await createSku(admin.agent, admin.csrfToken, product.id);
    const wh = await post(admin.agent, '/api/admin/warehouses', { code: 'WH-CLOSED', name: '停用仓', nameEn: 'Closed warehouse', active: false }, admin.csrfToken);
    expect(wh.status).toBe(201);
    await withWarehouseRuntime(async runtimeApp => {
      const a = await loggedInAgent('catalog.admin@example.test', runtimeApp);
      const result = await post(a.agent, '/api/admin/inventory/register', {
        skuId: sku.id, warehouseId: wh.body.warehouse.id, onHand: 12, reason: 'Should fail',
      }, a.csrfToken);
      expect(result.status).toBe(400); expect(result.body.error.code).toBe('invalid_warehouse');
      expect(await inventoryFacts(sku.id, wh.body.warehouse.id)).toEqual({ balances: '0', movements: '0', audits: '0' });
    });
  });

  it('warehouse registration: a queued deactivation wins before registration and rejects new stock', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken);
    const sku = await createSku(admin.agent, admin.csrfToken, product.id);
    const wh = await post(admin.agent, '/api/admin/warehouses', { code: 'WH-FIRST-OFF', name: '先停用', nameEn: 'Deactivate first' }, admin.csrfToken);
    expect(wh.status).toBe(201);
    const whId = wh.body.warehouse.id as string;
    await withWarehouseRuntime(async (runtimeApp, applicationName) => {
      const a = await loggedInAgent('catalog.admin@example.test', runtimeApp);
      const b = await loggedInAgent('catalog.admin@example.test', runtimeApp);
      const blocker = await pool.connect();
      let operations: Array<Promise<SupertestResponse>> = [];
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM warehouses WHERE id=$1 FOR UPDATE', [whId]);
        const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        const disable = patch(a.agent, `/api/admin/warehouses/${whId}`, { active: false }, a.csrfToken).then(r => r);
        operations.push(disable);
        let disablePid = 0;
        await waitForWarehouseCondition(async () => { disablePid = (await warehouseBlockedPids(applicationName, pid))[0] ?? 0; return disablePid > 0; });
        const register = post(b.agent, '/api/admin/inventory/register', { skuId: sku.id, warehouseId: whId, onHand: 12, reason: 'Must reject after deactivation' }, b.csrfToken).then(r => r);
        operations.push(register);
        await waitForWarehouseCondition(async () => (await warehouseBlockedPids(applicationName, disablePid)).length > 0);
        await blocker.query('COMMIT');
        const [disabled, rejected] = await Promise.all(operations);
        expect(disabled.status).toBe(200); expect(rejected.status).toBe(400);
        expect(rejected.body.error.code).toBe('invalid_warehouse');
        expect(await inventoryFacts(sku.id, whId)).toEqual({ balances: '0', movements: '0', audits: '0' });
      } finally { await blocker.query('ROLLBACK'); blocker.release(); await Promise.allSettled(operations); }
    });
  });

  it('warehouse registration: invalid quantities, missing CSRF and forbidden users create no facts', async () => {
    const admin = await loggedInAgent('catalog.admin@example.test');
    const product = await createProduct(admin.agent, admin.csrfToken);
    const sku = await createSku(admin.agent, admin.csrfToken, product.id);
    const input = { skuId: sku.id, warehouseId, onHand: 8, unsellable: 0, reason: 'Explicit count' };
    for (const change of [{ onHand: -1 }, { onHand: 1.5 }, { onHand: 100000001 }, { unsellable: 9 }, { reason: '' }]) {
      const result = await post(admin.agent, '/api/admin/inventory/register', { ...input, ...change }, admin.csrfToken);
      expect([400, 422]).toContain(result.status);
    }
    expect((await admin.agent.post('/api/admin/inventory/register').send(input)).status).toBe(403);
    for (const name of ['sales.one@example.test', 'AK000201A']) {
      const actor = await loggedInAgent(name);
      expect((await post(actor.agent, '/api/admin/inventory/register', input, actor.csrfToken)).status).toBe(403);
    }
    expect(await inventoryFacts(sku.id, warehouseId)).toEqual({ balances: '0', movements: '0', audits: '0' });
  });

  for (const failedTable of ['inventory_movements', 'audit_logs']) {
    it(`warehouse registration: ${failedTable} failure rolls back stock and preserves another warehouse`, async () => {
      const admin = await loggedInAgent('catalog.admin@example.test');
      const product = await createProduct(admin.agent, admin.csrfToken);
      const sku = await createSku(admin.agent, admin.csrfToken, product.id);
      expect((await post(admin.agent, '/api/admin/inventory/register', {
        skuId: sku.id, warehouseId, onHand: 17, reason: 'Existing source count',
      }, admin.csrfToken)).status).toBe(201);
      const condition = failedTable === 'audit_logs'
        ? `NEW.action='REGISTER_INVENTORY' AND NEW.target_id='${sku.id}:${warehouseBId}'`
        : `NEW.sku_id='${sku.id}'::uuid AND NEW.warehouse_id='${warehouseBId}'::uuid`;
      await pool.query(`CREATE FUNCTION warehouse_registration_fault_fn() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF ${condition} THEN RAISE EXCEPTION 'Warehouse injected transaction failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER warehouse_registration_fault BEFORE INSERT ON ${failedTable}
        FOR EACH ROW EXECUTE FUNCTION warehouse_registration_fault_fn();`);
      try {
        await withWarehouseRuntime(async runtimeApp => {
          const a = await loggedInAgent('catalog.admin@example.test', runtimeApp);
          const result = await post(a.agent, '/api/admin/inventory/register', {
            skuId: sku.id, warehouseId: warehouseBId, onHand: 9, reason: 'New target count',
          }, a.csrfToken);
          expect(result.status).toBe(500); expect(result.text).not.toContain('injected');
          expect(await inventoryFacts(sku.id, warehouseBId)).toEqual({ balances: '0', movements: '0', audits: '0' });
          const source = await pool.query('SELECT on_hand, version FROM inventory_balances WHERE sku_id=$1 AND warehouse_id=$2', [sku.id, warehouseId]);
          expect(source.rows[0]).toEqual({ on_hand: 17, version: '1' });
        });
      } finally { await pool.query(`DROP TRIGGER warehouse_registration_fault ON ${failedTable}; DROP FUNCTION warehouse_registration_fault_fn()`); }
    });
  }

  it('runs catalogue and inventory writes through the restricted runtime role', async () => {
    const role = `aoking_runtime_catalog_${process.pid}`;
    const rolePassword = 'RuntimePass123!Strong';
    await provisionRuntimeRole({
      adminDatabaseUrl: databaseUrl(),
      runtimeUser: role,
      runtimePassword: rolePassword,
    });
    const runtimeUrl = new URL(databaseUrl());
    runtimeUrl.username = role;
    runtimeUrl.password = rolePassword;
    const runtimePool = createPool(runtimeUrl.toString());
    const runtimeApp = createApp({
      checkReadiness: () => checkReadiness(runtimePool),
      auth: { pool: runtimePool, config },
      mediaRoot,
    });

    try {
      await expect(runtimePool.query('CREATE TABLE runtime_should_fail (id integer)')).rejects.toThrow(
        /permission denied|must be owner/i
      );
      await expect(
        runtimePool.query('UPDATE inventory_balances SET reserved = 1')
      ).rejects.toThrow(/permission denied/i);
      await expect(runtimePool.query('DELETE FROM products')).rejects.toThrow(/permission denied/i);

      const adminAgent = request.agent(runtimeApp);
      const adminLogin = await login(adminAgent, 'catalog.admin@example.test');
      expect(adminLogin.response.status).toBe(200);
      const token = adminLogin.csrfToken;

      const warehouse = await post(
        adminAgent,
        '/api/admin/warehouses',
        { code: 'WH-RUNTIME', name: '运行时仓', nameEn: 'Runtime Warehouse' },
        token
      );
      expect(warehouse.status).toBe(201);

      const created = await post(
        adminAgent,
        '/api/admin/catalog/products',
        {
          brandId: 'brand-aoking',
          productCode: 'AKT-RUNTIME',
          title: '运行时商品',
          titleEn: 'Runtime Product',
          category: 'Business Backpacks',
          seriesId,
          tagIds: [tagId],
        },
        token
      );
      expect(created.status).toBe(201);
      const productId = created.body.product.id;

      const skuResponse = await post(
        adminAgent,
        `/api/admin/catalog/products/${productId}/skus`,
        {
          skuCode: 'AKT-RUNTIME-SKU',
          colorName: '黑',
          colorNameEn: 'Black',
          colorHex: '#000000',
          basePriceCents: 2500,
          initialInventory: { warehouseId: warehouse.body.warehouse.id, onHand: 6 },
        },
        token
      );
      expect(skuResponse.status).toBe(201);
      const skuId = skuResponse.body.sku.id;

      const upload = await uploadImage(adminAgent, token, productId);
      expect(upload.status).toBe(201);
      expect(
        (await post(adminAgent, `/api/admin/catalog/products/${productId}/publish`, {}, token)).status
      ).toBe(200);

      expect(
        (
          await patch(
            adminAgent,
            `/api/admin/inventory/${skuId}/${warehouse.body.warehouse.id}`,
            { onHand: 9, expectedVersion: 1, reason: 'runtime adjust' },
            token
          )
        ).status
      ).toBe(200);

      const preview = await post(
        adminAgent,
        '/api/admin/inventory/import/preview',
        {
          idempotencyKey: randomUUID(),
          rows: [
            {
              rowNumber: 1,
              skuCode: 'AKT-RUNTIME-SKU',
              warehouseCode: 'WH-RUNTIME',
              onHand: 11,
              unsellable: 1,
            },
          ],
        },
        token
      );
      expect(preview.status).toBe(201);
      expect(
        (
          await post(
            adminAgent,
            `/api/admin/inventory/import/${preview.body.preview.batchId}/commit`,
            {},
            token
          )
        ).status
      ).toBe(200);

      const customerAgent = request.agent(runtimeApp);
      const customerLogin = await login(customerAgent, 'AK000201A');
      expect(customerLogin.response.status).toBe(200);
      const catalog = await customerAgent.get('/api/catalog/products');
      expect(catalog.status).toBe(200);
      const runtimeProduct = catalog.body.products.find((item: { id: string }) => item.id === productId);
      expect(runtimeProduct).toBeTruthy();
      expect(runtimeProduct.skus[0].available).toBe(10);
      expect((await customerAgent.get(`/api/media/${upload.body.image.id}`)).status).toBe(200);
    } finally {
      await runtimePool.end();
      const owner = new Client({ connectionString: databaseUrl() });
      await owner.connect();
      await owner.query(`DROP OWNED BY "${role}"`).catch(() => {});
      await owner.query(`DROP ROLE "${role}"`).catch(() => {});
      await owner.end();
    }
  }, 60_000);
});
