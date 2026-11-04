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

async function loggedInAgent(username: string): Promise<{ agent: TestAgent; csrfToken: string }> {
  const agent = request.agent(app);
  const { response, csrfToken } = await login(agent, username);
  expect(response.status).toBe(200);
  return { agent, csrfToken };
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

    const repeatedPreview = await post(
      admin.agent,
      '/api/admin/inventory/import/preview',
      { idempotencyKey: key, rows: [] },
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
