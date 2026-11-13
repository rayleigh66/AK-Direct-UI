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
let warehouseId = '';
let brandId = 'brand-aoking';
let productCounter = 0;
let companyCounter = 0;

const customers: Record<string, { agent: TestAgent; csrf: string; userId: string }> = {};

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

async function createCompany(options: {
  assignedSalesUserId: string | null;
  letters: string[];
  grant?: boolean;
}): Promise<{ companyId: string; customers: Array<{ userId: string; username: string }> }> {
  companyCounter += 1;
  const digits = String(300 + companyCounter).padStart(6, '0');
  const customerCode = `C${digits}`;
  const companyId = randomUUID();
  await pool.query(
    `INSERT INTO customer_companies
      (id, customer_code, short_name, country_alpha3, assigned_sales_user_id, status,
       created_at, updated_at)
     VALUES ($1, $2, $3, 'USA', $4, 'active', now(), now())`,
    [companyId, customerCode, `Order Customer ${companyCounter}`, options.assignedSalesUserId]
  );
  const created: Array<{ userId: string; username: string }> = [];
  for (const letter of options.letters) {
    const userId = randomUUID();
    const username = `AK${digits}${letter}`;
    await pool.query(
      `INSERT INTO customer_users
        (id, company_id, username, account_letter, password_hash, must_change_password,
         status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, 'active', now(), now())`,
      [userId, companyId, username, letter, await hashPassword(PASSWORD)]
    );
    created.push({ userId, username });
  }
  if (options.grant !== false) {
    await pool.query(
      'INSERT INTO brand_grants (company_id, brand_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [companyId, brandId]
    );
  }
  return { companyId, customers: created };
}

async function csrf(agent: TestAgent): Promise<string> {
  const response = await agent.get('/api/auth/csrf');
  expect(response.status).toBe(200);
  return response.body.csrfToken as string;
}

async function login(username: string, targetApp: Express = app): Promise<{ agent: TestAgent; csrf: string }> {
  const agent = request.agent(targetApp);
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
function put(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.put(pathName).set('X-CSRF-Token', token).send(body as object);
}
function del(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.delete(pathName).set('X-CSRF-Token', token).send(body as object);
}

async function createPublishedProduct(
  admin: { agent: TestAgent; csrf: string },
  options: { priceCents?: number; onHand?: number; altSku?: boolean } = {}
): Promise<{ productId: string; skuId: string; skuCode: string; productCode: string }> {
  productCounter += 1;
  const productCode = `AKO-${String(productCounter).padStart(4, '0')}`;
  const skuCode = `${productCode}-BLK`;
  const product = await post(
    admin.agent,
    '/api/admin/catalog/products',
    {
      brandId,
      productCode,
      title: `订单测试商品 ${productCounter}`,
      titleEn: `Order Test Product ${productCounter}`,
      descriptionEn: 'Test product',
      category: 'Business Backpacks',
      material: 'Polyester',
      capacityOrSize: '20L',
    },
    admin.csrf
  );
  expect(product.status).toBe(201);
  const productId = product.body.product.id as string;

  const image = await admin.agent
    .post(`/api/admin/catalog/products/${productId}/images`)
    .set('X-CSRF-Token', admin.csrf)
    .set('Content-Type', 'image/png')
    .send(PNG);
  expect(image.status).toBe(201);

  const sku = await post(
    admin.agent,
    `/api/admin/catalog/products/${productId}/skus`,
    {
      skuCode,
      colorName: '哑光黑',
      colorNameEn: 'Matte Black',
      colorHex: '#1c1c1e',
      basePriceCents: options.priceCents ?? 3800,
      initialInventory: {
        warehouseId,
        onHand: options.onHand ?? 1000,
        unsellable: 0,
      },
    },
    admin.csrf
  );
  expect(sku.status).toBe(201);
  if (options.altSku) {
    const alt = await post(
      admin.agent,
      `/api/admin/catalog/products/${productId}/skus`,
      {
        skuCode: `${skuCode}-ALT`,
        colorName: '灰色',
        colorNameEn: 'Grey',
        colorHex: '#888888',
        basePriceCents: (options.priceCents ?? 3800) + 100,
      },
      admin.csrf
    );
    expect(alt.status).toBe(201);
  }

  const published = await post(
    admin.agent,
    `/api/admin/catalog/products/${productId}/publish`,
    {},
    admin.csrf
  );
  expect(published.status).toBe(200);

  return { productId, skuId: sku.body.sku.id, skuCode, productCode };
}

async function cartFor(agent: TestAgent): Promise<Record<string, any>> {
  const response = await agent.get('/api/cart');
  expect(response.status).toBe(200);
  return response.body.cart;
}

async function setCart(
  customer: { agent: TestAgent; csrf: string },
  skuId: string,
  quantity: number,
  expectedRevision?: number
): Promise<SupertestResponse> {
  const revision = expectedRevision ?? (await cartFor(customer.agent)).revision;
  return put(customer.agent, `/api/cart/items/${skuId}`, { quantity, expectedRevision: revision }, customer.csrf);
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    shippingMethod: 'Sea',
    destinationCountryAlpha3: 'USA',
    expectedShipDate: '2026-12-15',
    shippingRequirements: 'Standard export master cartons with pallet stretch wrap.',
    ...overrides,
  };
}

async function submit(
  customer: { agent: TestAgent; csrf: string },
  overrides: Record<string, unknown> = {},
  expectedRevision?: number
): Promise<SupertestResponse> {
  const cart = await cartFor(customer.agent);
  return post(
    customer.agent,
    '/api/orders',
    {
      idempotencyKey: randomUUID(),
      expectedCartRevision: expectedRevision ?? cart.revision,
      ...delivery(),
      ...overrides,
    },
    customer.csrf
  );
}

async function adjustInventory(
  admin: { agent: TestAgent; csrf: string },
  skuId: string,
  onHand: number
): Promise<void> {
  const current = await pool.query<{ version: string }>(
    'SELECT version FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
    [skuId, warehouseId]
  );
  const response = await patch(
    admin.agent,
    `/api/admin/inventory/${skuId}/${warehouseId}`,
    { onHand, expectedVersion: Number(current.rows[0].version), reason: 'test adjustment' },
    admin.csrf
  );
  expect(response.status).toBe(200);
}

describeDb('company shared cart and customer orders', () => {
  beforeAll(async () => {
    if (!safeDatabase) return;
    await resetSchema();
    await runMigrations(databaseUrl());
    pool = createPool(databaseUrl());
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'aoking-orders-media-'));
    app = createApp({
      checkReadiness: () => checkReadiness(pool),
      auth: { pool, config },
      mediaRoot,
    });

    adminId = await createInternal('Order Admin', 'order.admin@example.test', ['admin']);
    sales1Id = await createInternal('Sales One', 'order.sales1@example.test', ['sales']);
    sales2Id = await createInternal('Sales Two', 'order.sales2@example.test', ['sales']);

    const a = await createCompany({
      assignedSalesUserId: sales1Id,
      letters: ['A', 'B', 'C'],
    });
    companyAId = a.companyId;
    const b = await createCompany({
      assignedSalesUserId: sales2Id,
      letters: ['A'],
    });
    companyBId = b.companyId;

    const admin = await login('order.admin@example.test');
    const warehouse = await post(
      admin.agent,
      '/api/admin/warehouses',
      { code: 'WH-ORDER', name: '订单仓', nameEn: 'Order Warehouse' },
      admin.csrf
    );
    expect(warehouse.status).toBe(201);
    warehouseId = warehouse.body.warehouse.id;

    for (const [index, letter] of ['A', 'B', 'C'].entries()) {
      const logged = await login(a.customers[index].username);
      customers[`a${letter}`] = { ...logged, userId: a.customers[index].userId };
    }
    const loggedB = await login(b.customers[0].username);
    customers.ba = { ...loggedB, userId: b.customers[0].userId };
    void adminId;
  }, 60_000);

  afterAll(async () => {
    if (!safeDatabase) return;
    await pool.end();
    await resetSchema();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  }, 30_000);

  it('shares one cart across A/B/C accounts and isolates companies', async () => {
    const admin = await login('order.admin@example.test');
    const item = await createPublishedProduct(admin, { altSku: true });

    const initial = await cartFor(customers.aA.agent);
    expect(initial).toMatchObject({ revision: 1, itemCount: 0, totalQuantity: 0 });
    expect(JSON.stringify(initial)).not.toContain(companyAId);

    const added = await setCart(customers.aA, item.skuId, 10, initial.revision);
    expect(added.status).toBe(200);
    expect(added.body.cart).toMatchObject({
      revision: 2,
      itemCount: 1,
      totalQuantity: 10,
      referenceTotalCents: 38000,
      pricingMode: 'base_reference',
      isReferenceQuote: true,
    });
    expect(added.body.cart.items[0]).toMatchObject({
      skuId: item.skuId,
      quantity: 10,
      unitPriceCents: 3800,
      isAvailable: true,
    });

    const sharedB = await cartFor(customers.aB.agent);
    const sharedC = await cartFor(customers.aC.agent);
    expect(sharedB.items[0].quantity).toBe(10);
    expect(sharedC.revision).toBe(2);

    const otherCompany = await cartFor(customers.ba.agent);
    expect(otherCompany).toMatchObject({ revision: 1, itemCount: 0 });

    const otherAdd = await setCart(customers.ba, item.skuId, 10, otherCompany.revision);
    expect(otherAdd.status).toBe(200);
    expect((await cartFor(customers.aA.agent)).itemCount).toBe(1);
    expect((await cartFor(customers.ba.agent)).revision).toBe(2);
  });

  it('rejects stale revisions with the latest cart and sets (never accumulates) quantities', async () => {
    const revision = (await cartFor(customers.aA.agent)).revision;
    const first = await setCart(customers.aA, (await cartFor(customers.aA.agent)).items[0].skuId, 12, revision);
    expect(first.status).toBe(200);

    const stale = await setCart(customers.aB, (await cartFor(customers.aA.agent)).items[0].skuId, 15, revision);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('cart_version_conflict');
    expect(stale.body.cart.revision).toBe(first.body.cart.revision);
    expect(stale.body.cart.items[0].quantity).toBe(12);

    const retried = await setCart(
      customers.aB,
      (await cartFor(customers.aA.agent)).items[0].skuId,
      15,
      stale.body.cart.revision
    );
    expect(retried.status).toBe(200);
    expect(retried.body.cart.items[0].quantity).toBe(15);

    const sameAgain = await setCart(
      customers.aA,
      (await cartFor(customers.aA.agent)).items[0].skuId,
      15
    );
    expect(sameAgain.status).toBe(200);
    expect(sameAgain.body.cart.items[0].quantity).toBe(15);
  });

  it('persists the shared cart across logout and a new login', async () => {
    const before = await cartFor(customers.aC.agent);
    const loggedOut = await post(customers.aC.agent, '/api/auth/logout', {}, customers.aC.csrf);
    expect(loggedOut.status).toBe(200);
    const relogged = await login('AK000301A');
    customers.aA = { ...relogged, userId: customers.aA.userId };
    const after = await cartFor(customers.aA.agent);
    expect(after.revision).toBe(before.revision);
    expect(after.items[0].quantity).toBe(15);

    const reloggedC = await login('AK000301C');
    customers.aC = { ...reloggedC, userId: customers.aC.userId };
  });

  it('validates cart quantities, eligibility and stock without deleting invalid lines', async () => {
    const admin = await login('order.admin@example.test');
    const cart = await cartFor(customers.aA.agent);
    const skuId = cart.items[0].skuId;
    const revision = cart.revision;

    expect((await setCart(customers.aA, skuId, 9, revision)).status).toBe(400);
    expect((await setCart(customers.aA, skuId, 10.5, revision)).status).toBe(400);
    expect(
      (await put(customers.aA.agent, `/api/cart/items/${randomUUID()}`, {
        quantity: 10,
        expectedRevision: revision,
      }, customers.aA.csrf)).status
    ).toBe(404);

    const discontinued = await patch(
      admin.agent,
      `/api/admin/catalog/skus/${skuId}`,
      { sellableStatus: 'discontinued' },
      admin.csrf
    );
    expect(discontinued.status).toBe(200);
    const invalid = await cartFor(customers.aA.agent);
    expect(invalid.itemCount).toBe(1);
    expect(invalid.items[0].isAvailable).toBe(false);
    expect(invalid.items[0].issues.join(' ')).toMatch(/discontinued/i);
    expect(await setCart(customers.aA, skuId, 10)).toMatchObject({ status: 409 });

    await patch(admin.agent, `/api/admin/catalog/skus/${skuId}`, { sellableStatus: 'active' }, admin.csrf);
    const productId = (await cartFor(customers.aA.agent)).items[0].productId;
    expect(
      (await post(admin.agent, `/api/admin/catalog/products/${productId}/unpublish`, {}, admin.csrf)).status
    ).toBe(200);
    expect((await cartFor(customers.aA.agent)).items[0].isAvailable).toBe(false);
    expect(await setCart(customers.aA, skuId, 10)).toMatchObject({ status: 409 });
    await post(admin.agent, `/api/admin/catalog/products/${productId}/publish`, {}, admin.csrf);

    expect(
      (await put(admin.agent, `/api/admin/companies/${companyAId}/brands/${brandId}`, { granted: false }, admin.csrf)).status
    ).toBe(200);
    expect((await cartFor(customers.aA.agent)).items[0].issues.join(' ')).toMatch(/authorized/i);
    expect(await setCart(customers.aA, skuId, 10)).toMatchObject({ status: 409 });
    await put(admin.agent, `/api/admin/companies/${companyAId}/brands/${brandId}`, { granted: true }, admin.csrf);

    await adjustInventory(admin, skuId, 20);
    const lowStock = await setCart(customers.aA, skuId, 50);
    expect(lowStock.status).toBe(409);
    expect(lowStock.body.error.code).toBe('insufficient_stock');
    expect(lowStock.body.available).toBe(20);
    await adjustInventory(admin, skuId, 1000);

    const restored = await cartFor(customers.aA.agent);
    expect(restored.itemCount).toBe(1);
    expect(restored.items[0].isAvailable).toBe(true);
  });

  it('redacts revoked-brand cart JSON through the runtime role, restores grants and permits explicit removal', async () => {
    const role = `aoking_runtime_redaction_${process.pid}`;
    await provisionRuntimeRole({
      adminDatabaseUrl: databaseUrl(), runtimeUser: role, runtimePassword: 'RuntimeRedaction123!',
    });
    const runtimeUrl = new URL(databaseUrl());
    runtimeUrl.username = role;
    runtimeUrl.password = 'RuntimeRedaction123!';
    const runtimePool = createPool(runtimeUrl.toString());
    const runtimeApp = createApp({
      checkReadiness: () => checkReadiness(runtimePool),
      auth: { pool: runtimePool, config }, mediaRoot,
    });
    try {
      const admin = await login('order.admin@example.test', runtimeApp);
      const item = await createPublishedProduct(admin, { priceCents: 7349, onHand: 23 });
      const company = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
      const customer = await login(company.customers[0].username, runtimeApp);
      const other = await login('AK000302A', runtimeApp);
      const added = await setCart(customer, item.skuId, 10);
      expect(added.status).toBe(200);
      const original = added.body.cart.items[0];
      expect(original).toMatchObject({ unitPriceCents: 7349, lineTotalCents: 73490, available: 23 });
      expect(original.imageUrl).toMatch(/^\/api\/media\//);
      const grantUrl = `/api/admin/companies/${company.companyId}/brands/${brandId}`;
      expect((await admin.agent.put(grantUrl).send({ granted: false })).status).toBe(403);
      expect((await put(admin.agent, grantUrl, { granted: false }, admin.csrf)).status).toBe(200);
      const revoked = await customer.agent.get('/api/cart');
      expect(revoked.status).toBe(200);
      const assertRestricted = (cart: typeof revoked.body.cart) => {
        expect(cart).toMatchObject({ itemCount: 1, totalQuantity: 10, referenceTotalCents: 0, hasUnavailableItems: true });
        expect(cart.items[0]).toEqual({
          skuId: item.skuId, quantity: 10, isAvailable: false, detailsRestricted: true,
          updatedAt: original.updatedAt,
          issues: ['Your company is no longer authorized for this brand.'],
        });
        const json = JSON.stringify(cart);
        for (const value of [original.productId, original.productCode, original.productTitle,
          original.productTitleEn, original.skuCode, original.colorName, original.colorNameEn,
          original.colorHex, original.imageUrl, '7349', 'unitPriceCents', 'lineTotalCents', '"available":']) {
          expect(json).not.toContain(value);
        }
      };
      assertRestricted(revoked.body.cart);
      expect((await customer.agent.get(`/api/catalog/products/${item.productId}`)).status).toBe(404);
      expect((await customer.agent.get(original.imageUrl)).status).toBe(404);
      const catalog = await customer.agent.get('/api/catalog/products');
      expect(catalog.status).toBe(200);
      expect(JSON.stringify(catalog.body)).not.toContain(item.productId);
      const stale = await setCart(customer, item.skuId, 10, added.body.cart.revision - 1);
      expect(stale.status).toBe(409);
      assertRestricted(stale.body.cart);
      const staleSubmit = await post(customer.agent, '/api/orders', {
        idempotencyKey: randomUUID(), expectedCartRevision: added.body.cart.revision - 1, ...delivery(),
      }, customer.csrf);
      expect(staleSubmit.status).toBe(409);
      assertRestricted(staleSubmit.body.cart);
      expect((await setCart(customer, item.skuId, 10)).status).toBe(409);
      const deniedSubmit = await post(customer.agent, '/api/orders', {
        idempotencyKey: randomUUID(), expectedCartRevision: added.body.cart.revision, ...delivery(),
      }, customer.csrf);
      expect(deniedSubmit.status).toBe(422);
      expect(deniedSubmit.body.error.code).toBe('brand_not_authorized');
      expect(deniedSubmit.text).not.toContain(original.productCode);
      expect(deniedSubmit.text).not.toContain(original.skuCode);

      const otherCart = await cartFor(other.agent);
      expect(otherCart.items.some((line: { skuId: string }) => line.skuId === item.skuId)).toBe(false);
      expect((await del(other.agent, `/api/cart/items/${item.skuId}`, {
        expectedRevision: otherCart.revision,
      }, other.csrf)).status).toBe(404);
      expect((await put(admin.agent, grantUrl, { granted: true }, admin.csrf)).status).toBe(200);
      const restored = await cartFor(customer.agent);
      expect(restored.items[0]).toMatchObject(original);
      expect(restored.referenceTotalCents).toBe(73490);
      expect((await customer.agent.get(original.imageUrl)).status).toBe(200);
      expect((await customer.agent.get(`/api/catalog/products/${item.productId}`)).status).toBe(200);
      expect((await put(admin.agent, grantUrl, { granted: false }, admin.csrf)).status).toBe(200);
      expect((await customer.agent.delete(`/api/cart/items/${item.skuId}`).send({ expectedRevision: restored.revision })).status).toBe(403);
      const removed = await del(customer.agent, `/api/cart/items/${item.skuId}`, {
        expectedRevision: restored.revision,
      }, customer.csrf);
      expect(removed.status).toBe(200);
      expect(removed.body.cart.itemCount).toBe(0);
    } finally {
      await runtimePool.end();
      await pool.query(`DROP OWNED BY "${role}"`);
      await pool.query(`DROP ROLE "${role}"`);
    }
  }, 60_000);

  it('restricts unpublished cart details but retains authorized discontinued SKU information', async () => {
    const admin = await login('order.admin@example.test');
    const item = await createPublishedProduct(admin, { altSku: true });
    const company = await createCompany({ assignedSalesUserId: null, letters: ['A'] });
    const customer = await login(company.customers[0].username);
    const added = await setCart(customer, item.skuId, 10);
    const original = added.body.cart.items[0];
    expect((await patch(admin.agent, `/api/admin/catalog/skus/${item.skuId}`, {
      sellableStatus: 'discontinued',
    }, admin.csrf)).status).toBe(200);
    const discontinued = await cartFor(customer.agent);
    expect(discontinued.items[0]).toMatchObject({
      unitPriceCents: 3800, productTitleEn: original.productTitleEn, isAvailable: false,
      issues: ['This SKU is discontinued.'],
    });
    expect((await post(admin.agent, `/api/admin/catalog/products/${item.productId}/unpublish`, {}, admin.csrf)).status).toBe(200);
    const unpublished = await cartFor(customer.agent);
    expect(unpublished.items[0]).toEqual({
      skuId: item.skuId, quantity: 10, updatedAt: original.updatedAt, isAvailable: false,
      detailsRestricted: true, issues: ['This product is no longer published.'],
    });
    expect(unpublished.referenceTotalCents).toBe(0);
    expect((await customer.agent.get(original.imageUrl)).status).toBe(404);
    expect((await post(admin.agent, `/api/admin/catalog/products/${item.productId}/publish`, {}, admin.csrf)).status).toBe(200);
    expect((await cartFor(customer.agent)).items[0]).toMatchObject(discontinued.items[0]);
  });

  it('removes and clears cart lines with revision protection', async () => {
    const cart = await cartFor(customers.aA.agent);
    const skuId = cart.items[0].skuId;

    const staleRemove = await del(
      customers.aA.agent,
      `/api/cart/items/${skuId}`,
      { expectedRevision: cart.revision - 1 },
      customers.aA.csrf
    );
    expect(staleRemove.status).toBe(409);
    const removed = await del(
      customers.aA.agent,
      `/api/cart/items/${skuId}`,
      { expectedRevision: cart.revision },
      customers.aA.csrf
    );
    expect(removed.status).toBe(200);
    expect(removed.body.cart.itemCount).toBe(0);

    expect((await setCart(customers.aA, skuId, 10)).status).toBe(200);
    const beforeClear = await cartFor(customers.aA.agent);
    const staleClear = await del(customers.aA.agent, '/api/cart/items', {
      expectedRevision: beforeClear.revision - 1,
    }, customers.aA.csrf);
    expect(staleClear.status).toBe(409);
    const cleared = await del(customers.aA.agent, '/api/cart/items', {
      expectedRevision: beforeClear.revision,
    }, customers.aA.csrf);
    expect(cleared.status).toBe(200);
    expect(cleared.body.cart.itemCount).toBe(0);

    expect((await setCart(customers.aA, skuId, 15)).status).toBe(200);
  });

  it('re-validates the cart server-side on submit and keeps the cart on every failure', async () => {
    const admin = await login('order.admin@example.test');
    const cart = await cartFor(customers.aA.agent);
    const skuId = cart.items[0].skuId;
    const revision = cart.revision;

    const privacy = await submit(customers.aA, {
      shippingRequirements: 'Please call +1 555 123 4567 before shipping.',
    });
    expect(privacy.status).toBe(422);
    expect(privacy.body.error.code).toBe('privacy_violation');

    const badCountry = await submit(customers.aA, { destinationCountryAlpha3: 'ZZZ' });
    expect(badCountry.status).toBe(400);
    const badDate = await submit(customers.aA, { expectedShipDate: '2026-02-30' });
    expect(badDate.status).toBe(400);
    const badMethod = await submit(customers.aA, { shippingMethod: 'Teleport' });
    expect(badMethod.status).toBe(400);
    expect((await cartFor(customers.aA.agent)).revision).toBe(revision);

    await adjustInventory(admin, skuId, 5);
    const low = await submit(customers.aA);
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('insufficient_stock');
    expect((await cartFor(customers.aA.agent)).items).toHaveLength(1);
    await adjustInventory(admin, skuId, 1000);

    await patch(admin.agent, `/api/admin/catalog/skus/${skuId}`, { sellableStatus: 'discontinued' }, admin.csrf);
    expect((await submit(customers.aA)).body.error.code).toBe('sku_unavailable');
    expect((await cartFor(customers.aA.agent)).itemCount).toBe(1);
    await patch(admin.agent, `/api/admin/catalog/skus/${skuId}`, { sellableStatus: 'active' }, admin.csrf);

    const productId = (await cartFor(customers.aA.agent)).items[0].productId;
    await post(admin.agent, `/api/admin/catalog/products/${productId}/unpublish`, {}, admin.csrf);
    expect((await submit(customers.aA)).body.error.code).toBe('product_unavailable');
    await post(admin.agent, `/api/admin/catalog/products/${productId}/publish`, {}, admin.csrf);

    await put(admin.agent, `/api/admin/companies/${companyAId}/brands/${brandId}`, { granted: false }, admin.csrf);
    expect((await submit(customers.aA)).body.error.code).toBe('brand_not_authorized');
    await put(admin.agent, `/api/admin/companies/${companyAId}/brands/${brandId}`, { granted: true }, admin.csrf);
    expect((await cartFor(customers.aA.agent)).itemCount).toBe(1);
  });

  it('submits one reference order atomically, clears the cart and handles idempotency', async () => {
    const cart = await cartFor(customers.aA.agent);
    const revision = cart.revision;
    const idempotencyKey = randomUUID();
    const body = {
      idempotencyKey,
      expectedCartRevision: revision,
      ...delivery(),
    };
    const created = await post(customers.aA.agent, '/api/orders', body, customers.aA.csrf);
    expect(created.status).toBe(201);
    expect(created.body.alreadySubmitted).toBe(false);
    const order = created.body.order;
    expect(order.orderNo).toMatch(/^OD-[0-9]{6}-[0-9]{4}$/);
    expect(order.status).toBe('PENDING_CONFIRMATION');
    expect(order.referenceTotalCents).toBe(57000); // 15 x 3800
    expect(order.pricingMode).toBe('base_reference');
    expect(order.isReferenceQuote).toBe(true);
    expect(order.priceNote).toMatch(/Phase 4B-05/);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({
      quantity: 15,
      baseUnitPriceCents: 3800,
      referenceUnitPriceCents: 3800,
      lineReferenceCents: 57000,
      priceSource: 'base_price',
    });

    const cleared = await cartFor(customers.aA.agent);
    expect(cleared.itemCount).toBe(0);
    expect(cleared.revision).toBe(revision + 1);

    const again = await post(customers.aA.agent, '/api/orders', body, customers.aA.csrf);
    expect(again.status).toBe(200);
    expect(again.body.alreadySubmitted).toBe(true);
    expect(again.body.order.id).toBe(order.id);
    expect((await pool.query('SELECT 1 FROM orders')).rowCount).toBe(1);

    const conflict = await post(
      customers.aA.agent,
      '/api/orders',
      { ...body, shippingMethod: 'Air' },
      customers.aA.csrf
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('idempotency_conflict');

    const empty = await submit(customers.aA);
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe('cart_empty');

    const reserved = await pool.query<{ total: string }>(
      'SELECT COALESCE(SUM(reserved), 0)::text AS total FROM inventory_balances WHERE sku_id = $1',
      [order.lines[0].skuId]
    );
    expect(reserved.rows[0].total).toBe('0');

    const detail = await customers.aA.agent.get(`/api/orders/${order.id}`);
    expect(detail.status).toBe(200);
    const serialized = JSON.stringify(detail.body.order);
    expect(serialized).not.toContain('assignedSalesUserId');
    expect(serialized).not.toContain('internalNote');
    expect(serialized).not.toContain('companyId');
    expect(serialized).not.toContain('createdBy');

    const crossCompany = await customers.ba.agent.get(`/api/orders/${order.id}`);
    expect(crossCompany.status).toBe(404);
    const list = await customers.ba.agent.get('/api/orders');
    expect(list.status).toBe(200);
    expect(list.body.orders).toHaveLength(0);
  });

  it('allows quantity changes and cancellation only while pending, with history and no duplicate success audit', async () => {
    const admin = await login('order.admin@example.test');
    const item = await createPublishedProduct(admin, { priceCents: 4200 });
    expect((await setCart(customers.aB, item.skuId, 10)).status).toBe(200);
    const created = await submit(customers.aB);
    expect(created.status).toBe(201);
    const order = created.body.order;
    expect(order.referenceTotalCents).toBe(42000);

    await patch(admin.agent, `/api/admin/catalog/skus/${item.skuId}`, { basePriceCents: 5000 }, admin.csrf);
    const modified = await patch(
      customers.aB.agent,
      `/api/orders/${order.id}/lines`,
      { expectedRevision: order.revision, lines: [{ skuId: item.skuId, quantity: 20 }] },
      customers.aB.csrf
    );
    expect(modified.status).toBe(200);
    expect(modified.body.order.referenceTotalCents).toBe(84000);
    expect(modified.body.order.lines[0].referenceUnitPriceCents).toBe(4200);
    expect(modified.body.order.history.some((event: { eventType: string }) => event.eventType === 'LINES_MODIFIED')).toBe(true);

    const stale = await patch(
      customers.aB.agent,
      `/api/orders/${order.id}/lines`,
      { expectedRevision: order.revision, lines: [{ skuId: item.skuId, quantity: 30 }] },
      customers.aB.csrf
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('order_version_conflict');
    expect(stale.body.order.revision).toBe(modified.body.order.revision);

    const moq = await patch(
      customers.aB.agent,
      `/api/orders/${order.id}/lines`,
      { expectedRevision: modified.body.order.revision, lines: [{ skuId: item.skuId, quantity: 9 }] },
      customers.aB.csrf
    );
    expect(moq.status).toBe(400);

    const cancelled = await post(
      customers.aB.agent,
      `/api/orders/${order.id}/cancel`,
      { expectedRevision: modified.body.order.revision, reason: 'Changed plan' },
      customers.aB.csrf
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');
    expect(cancelled.body.order.cancelReason).toBe('Changed plan');

    const repeated = await post(
      customers.aB.agent,
      `/api/orders/${order.id}/cancel`,
      { expectedRevision: cancelled.body.order.revision, reason: 'Again' },
      customers.aB.csrf
    );
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe('order_status_conflict');

    const audits = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'CANCEL_ORDER' AND target_id = $1",
      [order.id]
    );
    expect(audits.rows[0].count).toBe('1');

    const modifyCancelled = await patch(
      customers.aB.agent,
      `/api/orders/${order.id}/lines`,
      { expectedRevision: cancelled.body.order.revision, lines: [{ skuId: item.skuId, quantity: 10 }] },
      customers.aB.csrf
    );
    expect(modifyCancelled.status).toBe(409);

    const notifications = await pool.query<{ audience: string; status: string }>(
      'SELECT DISTINCT audience, status FROM order_notifications WHERE order_id = $1 ORDER BY audience',
      [order.id]
    );
    expect(notifications.rows.map(row => row.audience)).toEqual(['customer', 'sales']);
    expect(notifications.rows.every(row => row.status === 'pending')).toBe(true);
  });

  it('serialises concurrent submissions of the same company cart to at most one order', async () => {
    const cart = await cartFor(customers.aA.agent);
    const revision = cart.revision;
    const item = (await cartFor(customers.ba.agent)).items[0];
    expect((await setCart(customers.aA, item.skuId, 10, revision)).status).toBe(200);
    const expected = (await cartFor(customers.aA.agent)).revision;
    const before = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM orders WHERE company_id = $1',
      [companyAId]
    );

    const [left, right] = await Promise.all([
      post(customers.aA.agent, '/api/orders', {
        idempotencyKey: randomUUID(),
        expectedCartRevision: expected,
        ...delivery(),
      }, customers.aA.csrf),
      post(customers.aB.agent, '/api/orders', {
        idempotencyKey: randomUUID(),
        expectedCartRevision: expected,
        ...delivery(),
      }, customers.aB.csrf),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 409]);
    const after = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM orders WHERE company_id = $1',
      [companyAId]
    );
    expect(Number(after.rows[0].count) - Number(before.rows[0].count)).toBe(1);
    expect((await cartFor(customers.aA.agent)).itemCount).toBe(0);
  });

  it('returns the same order for concurrent retries with one idempotency key', async () => {
    const skuId = (await cartFor(customers.ba.agent)).items[0].skuId;
    expect((await setCart(customers.aA, skuId, 10)).status).toBe(200);
    const expected = (await cartFor(customers.aA.agent)).revision;
    const body = {
      idempotencyKey: randomUUID(),
      expectedCartRevision: expected,
      ...delivery(),
    };
    const [left, right] = await Promise.all([
      post(customers.aA.agent, '/api/orders', body, customers.aA.csrf),
      post(customers.aA.agent, '/api/orders', body, customers.aA.csrf),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(left.body.order.id).toBe(right.body.order.id);
    const stored = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM orders WHERE order_no = $1',
      [left.body.order.orderNo]
    );
    expect(stored.rows[0].count).toBe('1');
  });

  it('generates unique daily order numbers under concurrent submissions from different companies', async () => {
    const admin = await login('order.admin@example.test');
    const item = await createPublishedProduct(admin, { onHand: 500 });
    const agents = [];
    for (let index = 0; index < 4; index += 1) {
      const company = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
      const logged = await login(company.customers[0].username);
      expect((await setCart(logged, item.skuId, 10)).status).toBe(200);
      agents.push(logged);
    }
    const responses = await Promise.all(agents.map(agent => submit(agent)));
    expect(responses.map(response => response.status)).toEqual([201, 201, 201, 201]);
    const orderNos = responses.map(response => response.body.order.orderNo as string);
    expect(new Set(orderNos).size).toBe(orderNos.length);
    for (const orderNo of orderNos) {
      expect(orderNo).toMatch(/^OD-[0-9]{6}-[0-9]{4}$/);
    }
  });

  it('scopes sales to assigned companies and administrators read all orders (read-only)', async () => {
    const sales1 = await login('order.sales1@example.test');
    const sales2 = await login('order.sales2@example.test');
    const admin = await login('order.admin@example.test');

    const companyBOrder = await submit(customers.ba);
    expect(companyBOrder.status).toBe(201);

    const assigned = await sales1.agent.get('/api/sales/orders');
    expect(assigned.status).toBe(200);
    expect(assigned.body.orders.length).toBeGreaterThan(0);
    expect(assigned.body.orders.every((order: { company: { id: string } }) => order.company.id !== companyBId)).toBe(true);
    expect(assigned.body.orders[0]).toHaveProperty('company.customerCode');
    expect(assigned.body.orders[0]).toHaveProperty('history');

    const otherSales = await sales2.agent.get('/api/sales/orders');
    expect(otherSales.status).toBe(200);
    expect(otherSales.body.orders.length).toBeGreaterThan(0);
    expect(otherSales.body.orders.every((order: { company: { id: string } }) => order.company.id === companyBId)).toBe(true);

    const foreign = await sales1.agent.get(`/api/sales/orders/${otherSales.body.orders[0].id}`);
    expect(foreign.status).toBe(404);

    const all = await admin.agent.get('/api/admin/orders');
    expect(all.status).toBe(200);
    expect(all.body.orders.length).toBeGreaterThanOrEqual(assigned.body.orders.length + otherSales.body.orders.length);

    expect((await admin.agent.post('/api/orders').send({})).status).toBe(403);
    expect((await customers.aA.agent.get('/api/sales/orders')).status).toBe(403);

    const pending = assigned.body.orders.find((order: { status: string }) => order.status === 'PENDING_CONFIRMATION');
    const noCsrf = await customers.aA.agent
      .post(`/api/orders/${pending.id}/cancel`)
      .send({ expectedRevision: pending.revision });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('csrf_failed');

    const noCsrfCart = await customers.aA.agent
      .put(`/api/cart/items/${randomUUID()}`)
      .send({ quantity: 10, expectedRevision: 1 });
    expect(noCsrfCart.status).toBe(403);
    expect(noCsrfCart.body.error.code).toBe('csrf_failed');

    // A suspended customer account loses its session immediately.
    const suspended = await patch(
      admin.agent,
      `/api/admin/customers/${customers.ba.userId}/status`,
      { status: 'suspended' },
      admin.csrf
    );
    expect(suspended.status).toBe(200);
    expect((await customers.ba.agent.get('/api/cart')).status).toBe(401);
    await patch(
      admin.agent,
      `/api/admin/customers/${customers.ba.userId}/status`,
      { status: 'active' },
      admin.csrf
    );
  });

  it('previews and enforces PENDING-order cancellation for destructive admin actions', async () => {
    const admin = await login('order.admin@example.test');

    async function pendingOrderFor(item: { skuId: string }): Promise<Record<string, any>> {
      expect((await setCart(customers.aC, item.skuId, 10)).status).toBe(200);
      const response = await submit(customers.aC);
      expect(response.status).toBe(201);
      return response.body.order;
    }

    // Product unpublish: preview -> new affected order invalidates the token ->
    // fresh preview -> confirmed action cancels every pending order atomically.
    const productItem = await createPublishedProduct(admin);
    const first = await pendingOrderFor(productItem);
    const preview = await admin.agent.get(
      `/api/admin/orders/impact?kind=product_unpublish&targetId=${productItem.productId}`
    );
    expect(preview.status).toBe(200);
    expect(preview.body.impact.affectedOrders.map((order: { id: string }) => order.id)).toContain(first.id);
    expect(preview.body.impact.impactToken).toMatch(/^[a-f0-9]{64}$/);

    const blocked = await post(
      admin.agent,
      `/api/admin/catalog/products/${productItem.productId}/unpublish`,
      {},
      admin.csrf
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('pending_orders_affected');
    expect(blocked.body.impact.affectedOrders).toHaveLength(1);
    expect((await pool.query('SELECT 1 FROM orders WHERE id = $1 AND status = $2', [first.id, 'PENDING_CONFIRMATION'])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM products WHERE id = $1 AND published = true", [productItem.productId])).rowCount).toBe(1);

    const second = await pendingOrderFor(productItem);
    const stale = await post(
      admin.agent,
      `/api/admin/catalog/products/${productItem.productId}/unpublish`,
      { confirmAffectedOrders: true, impactToken: preview.body.impact.impactToken },
      admin.csrf
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('impact_changed');
    expect(stale.body.impact.affectedOrders).toHaveLength(2);

    const refreshed = await admin.agent.get(
      `/api/admin/orders/impact?kind=product_unpublish&targetId=${productItem.productId}`
    );
    const confirmed = await post(
      admin.agent,
      `/api/admin/catalog/products/${productItem.productId}/unpublish`,
      {
        confirmAffectedOrders: true,
        impactToken: refreshed.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.product.published).toBe(false);
    for (const order of [first, second]) {
      const row = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [order.id]);
      expect(row.rows[0].status).toBe('CANCELLED');
      const history = await pool.query(
        "SELECT 1 FROM order_status_history WHERE order_id = $1 AND event_type = 'ADMIN_CANCELLED'",
        [order.id]
      );
      expect(history.rowCount).toBe(1);
    }
    const queued = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM order_notifications WHERE order_id = ANY($1::uuid[]) AND event_type = 'ORDER_CANCELLED_BY_ADMIN'",
      [[first.id, second.id]]
    );
    expect(Number(queued.rows[0].count)).toBe(4); // customer + assigned sales for each order

    // SKU discontinuation. A second active SKU keeps the product published so
    // the last-active-SKU rule does not mask the pending-order impact rule.
    const skuItem = await createPublishedProduct(admin);
    const altSku = await post(
      admin.agent,
      `/api/admin/catalog/products/${skuItem.productId}/skus`,
      {
        skuCode: `${skuItem.skuCode}-ALT`,
        colorName: '灰色',
        colorNameEn: 'Grey',
        colorHex: '#888888',
        basePriceCents: 3900,
      },
      admin.csrf
    );
    expect(altSku.status).toBe(201);
    const skuOrder = await pendingOrderFor(skuItem);
    const skuBlocked = await patch(
      admin.agent,
      `/api/admin/catalog/skus/${skuItem.skuId}`,
      { sellableStatus: 'discontinued' },
      admin.csrf
    );
    expect(skuBlocked.status).toBe(409);
    const skuPreview = await admin.agent.get(
      `/api/admin/orders/impact?kind=sku_discontinue&targetId=${skuItem.skuId}`
    );
    const skuConfirmed = await patch(
      admin.agent,
      `/api/admin/catalog/skus/${skuItem.skuId}`,
      {
        sellableStatus: 'discontinued',
        confirmAffectedOrders: true,
        impactToken: skuPreview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(skuConfirmed.status).toBe(200);
    expect((await pool.query('SELECT status FROM orders WHERE id = $1', [skuOrder.id])).rows[0].status).toBe('CANCELLED');

    // Brand revoke for one company only.
    const brandItem = await createPublishedProduct(admin);
    const brandOrder = await pendingOrderFor(brandItem);
    const brandBlocked = await put(
      admin.agent,
      `/api/admin/companies/${companyAId}/brands/${brandId}`,
      { granted: false },
      admin.csrf
    );
    expect(brandBlocked.status).toBe(409);
    const brandPreview = await admin.agent.get(
      `/api/admin/orders/impact?kind=brand_revoke&targetId=${brandId}&companyId=${companyAId}`
    );
    const brandConfirmed = await put(
      admin.agent,
      `/api/admin/companies/${companyAId}/brands/${brandId}`,
      {
        granted: false,
        confirmAffectedOrders: true,
        impactToken: brandPreview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(brandConfirmed.status).toBe(200);
    expect((await pool.query('SELECT status FROM orders WHERE id = $1', [brandOrder.id])).rows[0].status).toBe('CANCELLED');
    await put(admin.agent, `/api/admin/companies/${companyAId}/brands/${brandId}`, { granted: true }, admin.csrf);

    // Company suspension.
    const suspendItem = await createPublishedProduct(admin);
    const suspendCompany = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
    const suspendLogin = await login(suspendCompany.customers[0].username);
    expect((await setCart(suspendLogin, suspendItem.skuId, 10)).status).toBe(200);
    const suspendOrder = await submit(suspendLogin);
    expect(suspendOrder.status).toBe(201);
    const suspendBlocked = await patch(
      admin.agent,
      `/api/admin/companies/${suspendCompany.companyId}/status`,
      { status: 'suspended' },
      admin.csrf
    );
    expect(suspendBlocked.status).toBe(409);
    const suspendPreview = await admin.agent.get(
      `/api/admin/orders/impact?kind=company_suspend&targetId=${suspendCompany.companyId}`
    );
    const suspendConfirmed = await patch(
      admin.agent,
      `/api/admin/companies/${suspendCompany.companyId}/status`,
      {
        status: 'suspended',
        confirmAffectedOrders: true,
        impactToken: suspendPreview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(suspendConfirmed.status).toBe(200);
    expect((await pool.query('SELECT status FROM orders WHERE id = $1', [suspendOrder.body.order.id])).rows[0].status).toBe('CANCELLED');
    expect((await suspendLogin.agent.get('/api/cart')).status).toBe(401);
  });

  it('reports the full cancellation result for brand revocation and company suspension', async () => {
    const admin = await login('order.admin@example.test');

    // Brand revoke: preview lists the exact pending order, the token is
    // required, a stale token is rejected, and confirmation records the
    // cancellation in the order history, notification outbox and audit log.
    const brandItem = await createPublishedProduct(admin, { onHand: 100 });
    const brandCompany = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
    const brandCustomer = await login(brandCompany.customers[0].username);
    expect((await setCart(brandCustomer, brandItem.skuId, 10)).status).toBe(200);
    const brandOrder = await submit(brandCustomer);
    expect(brandOrder.status).toBe(201);
    const brandOrderId = brandOrder.body.order.id as string;

    const brandPreview = await admin.agent.get(
      `/api/admin/orders/impact?kind=brand_revoke&targetId=${brandId}&companyId=${brandCompany.companyId}`
    );
    expect(brandPreview.status).toBe(200);
    expect(
      brandPreview.body.impact.affectedOrders.map((order: { id: string }) => order.id)
    ).toContain(brandOrderId);
    expect(brandPreview.body.impact.impactToken).toMatch(/^[a-f0-9]{64}$/);

    const brandBlocked = await put(
      admin.agent,
      `/api/admin/companies/${brandCompany.companyId}/brands/${brandId}`,
      { granted: false },
      admin.csrf
    );
    expect(brandBlocked.status).toBe(409);
    expect(brandBlocked.body.error.code).toBe('pending_orders_affected');

    const brandNoToken = await put(
      admin.agent,
      `/api/admin/companies/${brandCompany.companyId}/brands/${brandId}`,
      { granted: false, confirmAffectedOrders: true },
      admin.csrf
    );
    expect(brandNoToken.status).toBe(409);
    expect(brandNoToken.body.error.code).toBe('impact_confirmation_required');

    const brandStale = await put(
      admin.agent,
      `/api/admin/companies/${brandCompany.companyId}/brands/${brandId}`,
      { granted: false, confirmAffectedOrders: true, impactToken: '0'.repeat(64) },
      admin.csrf
    );
    expect(brandStale.status).toBe(409);
    expect(brandStale.body.error.code).toBe('impact_changed');

    const brandConfirmed = await put(
      admin.agent,
      `/api/admin/companies/${brandCompany.companyId}/brands/${brandId}`,
      {
        granted: false,
        confirmAffectedOrders: true,
        impactToken: brandPreview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(brandConfirmed.status).toBe(200);

    const brandOrderRow = await pool.query<{ status: string; cancel_reason: string | null }>(
      'SELECT status, cancel_reason FROM orders WHERE id = $1',
      [brandOrderId]
    );
    expect(brandOrderRow.rows[0].status).toBe('CANCELLED');
    expect(brandOrderRow.rows[0].cancel_reason).toContain('no longer authorized');

    const brandHistory = await pool.query<{ details: { trigger?: string } }>(
      `SELECT details FROM order_status_history
       WHERE order_id = $1 AND event_type = 'ADMIN_CANCELLED'`,
      [brandOrderId]
    );
    expect(brandHistory.rowCount).toBe(1);
    expect(brandHistory.rows[0].details.trigger).toBe('brand_revoke');

    const brandNotifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM order_notifications
       WHERE order_id = $1 AND event_type = 'ORDER_CANCELLED_BY_ADMIN'`,
      [brandOrderId]
    );
    expect(Number(brandNotifications.rows[0].count)).toBe(2);

    const brandAudit = await pool.query<{ details: { cancelledPendingOrders?: number } }>(
      `SELECT details FROM audit_logs
       WHERE action = 'REVOKE_BRAND' AND target_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [brandCompany.companyId]
    );
    expect(brandAudit.rows[0].details.cancelledPendingOrders).toBe(1);

    // Restore the grant so the company remains usable for the next action.
    expect(
      (
        await put(
          admin.agent,
          `/api/admin/companies/${brandCompany.companyId}/brands/${brandId}`,
          { granted: true },
          admin.csrf
        )
      ).status
    ).toBe(200);

    // Company suspend: the same preview -> token -> atomic cancellation flow,
    // plus session revocation and the audit result.
    const suspendItem = await createPublishedProduct(admin, { onHand: 100 });
    const suspendCompany = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
    const suspendCustomer = await login(suspendCompany.customers[0].username);
    expect((await setCart(suspendCustomer, suspendItem.skuId, 10)).status).toBe(200);
    const suspendOrder = await submit(suspendCustomer);
    expect(suspendOrder.status).toBe(201);
    const suspendOrderId = suspendOrder.body.order.id as string;

    const suspendPreview = await admin.agent.get(
      `/api/admin/orders/impact?kind=company_suspend&targetId=${suspendCompany.companyId}`
    );
    expect(suspendPreview.status).toBe(200);
    expect(
      suspendPreview.body.impact.affectedOrders.map((order: { id: string }) => order.id)
    ).toContain(suspendOrderId);
    expect(suspendPreview.body.impact.impactToken).toMatch(/^[a-f0-9]{64}$/);

    const suspendBlocked = await patch(
      admin.agent,
      `/api/admin/companies/${suspendCompany.companyId}/status`,
      { status: 'suspended' },
      admin.csrf
    );
    expect(suspendBlocked.status).toBe(409);
    expect(suspendBlocked.body.error.code).toBe('pending_orders_affected');

    const suspendNoToken = await patch(
      admin.agent,
      `/api/admin/companies/${suspendCompany.companyId}/status`,
      { status: 'suspended', confirmAffectedOrders: true },
      admin.csrf
    );
    expect(suspendNoToken.status).toBe(409);
    expect(suspendNoToken.body.error.code).toBe('impact_confirmation_required');

    const suspendStale = await patch(
      admin.agent,
      `/api/admin/companies/${suspendCompany.companyId}/status`,
      { status: 'suspended', confirmAffectedOrders: true, impactToken: '0'.repeat(64) },
      admin.csrf
    );
    expect(suspendStale.status).toBe(409);
    expect(suspendStale.body.error.code).toBe('impact_changed');

    const suspendConfirmed = await patch(
      admin.agent,
      `/api/admin/companies/${suspendCompany.companyId}/status`,
      {
        status: 'suspended',
        confirmAffectedOrders: true,
        impactToken: suspendPreview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(suspendConfirmed.status).toBe(200);
    expect(suspendConfirmed.body.company.status).toBe('suspended');

    const suspendOrderRow = await pool.query<{ status: string; cancel_reason: string | null }>(
      'SELECT status, cancel_reason FROM orders WHERE id = $1',
      [suspendOrderId]
    );
    expect(suspendOrderRow.rows[0].status).toBe('CANCELLED');
    expect(suspendOrderRow.rows[0].cancel_reason).toBe('the customer company was suspended');

    const suspendHistory = await pool.query<{ details: { trigger?: string } }>(
      `SELECT details FROM order_status_history
       WHERE order_id = $1 AND event_type = 'ADMIN_CANCELLED'`,
      [suspendOrderId]
    );
    expect(suspendHistory.rowCount).toBe(1);
    expect(suspendHistory.rows[0].details.trigger).toBe('company_suspend');

    const suspendNotifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM order_notifications
       WHERE order_id = $1 AND event_type = 'ORDER_CANCELLED_BY_ADMIN'`,
      [suspendOrderId]
    );
    expect(Number(suspendNotifications.rows[0].count)).toBe(2);

    const suspendAudit = await pool.query<{ details: { cancelledPendingOrders?: number } }>(
      `SELECT details FROM audit_logs
       WHERE action = 'SUSPEND_COMPANY' AND target_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [suspendCompany.companyId]
    );
    expect(suspendAudit.rows[0].details.cancelledPendingOrders).toBe(1);

    expect((await suspendCustomer.agent.get('/api/cart')).status).toBe(401);
  });

  it('never leaves a pending order for an unpublished product or suspended company under races', async () => {
    const admin = await login('order.admin@example.test');

    for (let round = 0; round < 4; round += 1) {
      const item = await createPublishedProduct(admin, { onHand: 200 });
      const company = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
      const customer = await login(company.customers[0].username);
      expect((await setCart(customer, item.skuId, 10)).status).toBe(200);

      const [submitted, unpublished] = await Promise.all([
        submit(customer),
        post(
          admin.agent,
          `/api/admin/catalog/products/${item.productId}/unpublish`,
          {},
          admin.csrf
        ),
      ]);
      if (submitted.status === 201) {
        expect(unpublished.status).toBe(409);
        expect(unpublished.body.error.code).toBe('pending_orders_affected');
        expect(
          (await pool.query('SELECT published FROM products WHERE id = $1', [item.productId]))
            .rows[0].published
        ).toBe(true);
        expect(
          (await pool.query('SELECT status FROM orders WHERE id = $1', [submitted.body.order.id]))
            .rows[0].status
        ).toBe('PENDING_CONFIRMATION');
      } else {
        expect(submitted.status).toBe(422);
        expect(submitted.body.error.code).toBe('product_unavailable');
        expect(unpublished.status).toBe(200);
        expect(
          (await pool.query('SELECT published FROM products WHERE id = $1', [item.productId]))
            .rows[0].published
        ).toBe(false);
        expect(
          (await pool.query('SELECT 1 FROM orders WHERE company_id = $1', [company.companyId]))
            .rowCount
        ).toBe(0);
      }
    }

    for (let round = 0; round < 4; round += 1) {
      const item = await createPublishedProduct(admin, { onHand: 200 });
      const company = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
      const customer = await login(company.customers[0].username);
      expect((await setCart(customer, item.skuId, 10)).status).toBe(200);

      const [submitted, suspended] = await Promise.all([
        submit(customer),
        patch(
          admin.agent,
          `/api/admin/companies/${company.companyId}/status`,
          { status: 'suspended' },
          admin.csrf
        ),
      ]);
      const companyStatus = (
        await pool.query('SELECT status FROM customer_companies WHERE id = $1', [
          company.companyId,
        ])
      ).rows[0].status as string;
      if (submitted.status === 201) {
        expect(suspended.status).toBe(409);
        expect(suspended.body.error.code).toBe('pending_orders_affected');
        expect(companyStatus).toBe('active');
        expect(
          (await pool.query('SELECT status FROM orders WHERE id = $1', [submitted.body.order.id]))
            .rows[0].status
        ).toBe('PENDING_CONFIRMATION');
      } else {
        expect(suspended.status).toBe(200);
        expect(companyStatus).toBe('suspended');
        expect(
          (await pool.query('SELECT 1 FROM orders WHERE company_id = $1', [company.companyId]))
            .rowCount
        ).toBe(0);
      }
    }
  }, 60_000);

  it('scopes sales access and notifications by the current company assignment', async () => {
    const admin = await login('order.admin@example.test');
    const item = await createPublishedProduct(admin, { onHand: 100 });
    const company = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
    const customer = await login(company.customers[0].username);
    expect((await setCart(customer, item.skuId, 10)).status).toBe(200);
    const created = await submit(customer);
    expect(created.status).toBe(201);
    const orderId = created.body.order.id as string;
    const skuId = created.body.order.lines[0].skuId as string;

    const sales1 = await login('order.sales1@example.test');
    const sales2 = await login('order.sales2@example.test');

    const sales1List = await sales1.agent.get('/api/sales/orders');
    expect(sales1List.status).toBe(200);
    expect(sales1List.body.orders.map((order: { id: string }) => order.id)).toContain(orderId);
    expect((await sales1.agent.get(`/api/sales/orders/${orderId}`)).status).toBe(200);

    const sales2List = await sales2.agent.get('/api/sales/orders');
    expect(sales2List.body.orders.map((order: { id: string }) => order.id)).not.toContain(orderId);
    expect((await sales2.agent.get(`/api/sales/orders/${orderId}`)).status).toBe(404);
    expect((await admin.agent.get(`/api/admin/orders/${orderId}`)).status).toBe(200);

    const before = await pool.query<{
      snapshot: string | null;
      current: string | null;
    }>(
      `SELECT o.assigned_sales_user_id AS snapshot, c.assigned_sales_user_id AS current
       FROM orders o JOIN customer_companies c ON c.id = o.company_id WHERE o.id = $1`,
      [orderId]
    );
    expect(before.rows[0]).toEqual({ snapshot: sales1Id, current: sales1Id });

    // A no longer owns the company: access must change even though the order's
    // submission-time snapshot still says A.
    const reassigned = await patch(
      admin.agent,
      `/api/admin/companies/${company.companyId}/sales-assignment`,
      { salesUserId: sales2Id },
      admin.csrf
    );
    expect(reassigned.status).toBe(200);

    const after = await pool.query<{ snapshot: string | null; current: string | null }>(
      `SELECT o.assigned_sales_user_id AS snapshot, c.assigned_sales_user_id AS current
       FROM orders o JOIN customer_companies c ON c.id = o.company_id WHERE o.id = $1`,
      [orderId]
    );
    expect(after.rows[0]).toEqual({ snapshot: sales1Id, current: sales2Id });

    const sales1After = await sales1.agent.get('/api/sales/orders');
    expect(sales1After.body.orders.map((order: { id: string }) => order.id)).not.toContain(
      orderId
    );
    expect((await sales1.agent.get(`/api/sales/orders/${orderId}`)).status).toBe(404);

    const sales2After = await sales2.agent.get('/api/sales/orders');
    expect(sales2After.body.orders.map((order: { id: string }) => order.id)).toContain(orderId);
    const sales2Detail = await sales2.agent.get(`/api/sales/orders/${orderId}`);
    expect(sales2Detail.status).toBe(200);
    expect(sales2Detail.body.order.assignedSalesUserId).toBe(sales1Id);
    expect(sales2Detail.body.order.currentAssignedSalesUserId).toBe(sales2Id);
    expect((await admin.agent.get('/api/admin/orders')).body.orders.map((order: { id: string }) => order.id)).toContain(orderId);
    expect((await admin.agent.get(`/api/admin/orders/${orderId}`)).status).toBe(200);

    // The submission notification to A is invalidated, not delivered later.
    const notificationsAfterReassign = await pool.query<{
      audience: string;
      internal_user_id: string | null;
      status: string;
      event_type: string;
      cancelled_at: Date | null;
    }>(
      `SELECT audience, internal_user_id, status, event_type, cancelled_at
       FROM order_notifications WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId]
    );
    const oldSales = notificationsAfterReassign.rows.find(
      row => row.audience === 'sales' && row.internal_user_id === sales1Id
    );
    expect(oldSales).toMatchObject({ status: 'cancelled' });
    expect(oldSales?.cancelled_at).not.toBeNull();
    expect(
      notificationsAfterReassign.rows.some(
        row => row.audience === 'customer' && row.status === 'pending'
      )
    ).toBe(true);

    // A post-reassignment change and cancellation notify only the new owner.
    const modified = await patch(
      customer.agent,
      `/api/orders/${orderId}/lines`,
      { expectedRevision: created.body.order.revision, lines: [{ skuId, quantity: 12 }] },
      customer.csrf
    );
    expect(modified.status).toBe(200);

    const afterModify = await pool.query<{
      internal_user_id: string | null;
      status: string;
      event_type: string;
    }>(
      `SELECT internal_user_id, status, event_type FROM order_notifications
       WHERE order_id = $1 AND audience = 'sales' ORDER BY created_at, id`,
      [orderId]
    );
    expect(
      afterModify.rows.some(
        row =>
          row.internal_user_id === sales2Id &&
          row.status === 'pending' &&
          row.event_type === 'ORDER_MODIFIED'
      )
    ).toBe(true);
    expect(
      afterModify.rows.some(
        row => row.internal_user_id === sales1Id && row.status === 'pending'
      )
    ).toBe(false);

    // A customer cancellation after reassignment notifies only the new owner.
    const cancelItem = await createPublishedProduct(admin, { onHand: 100 });
    expect((await setCart(customer, cancelItem.skuId, 10)).status).toBe(200);
    const second = await submit(customer);
    expect(second.status).toBe(201);
    const secondOrderId = second.body.order.id as string;
    const cancelled = await post(
      customer.agent,
      `/api/orders/${secondOrderId}/cancel`,
      { expectedRevision: second.body.order.revision, reason: 'Second order changed' },
      customer.csrf
    );
    expect(cancelled.status).toBe(200);
    const secondSalesNotifications = await pool.query<{
      internal_user_id: string | null;
      status: string;
      event_type: string;
    }>(
      `SELECT internal_user_id, status, event_type FROM order_notifications
       WHERE order_id = $1 AND audience = 'sales' ORDER BY created_at, id`,
      [secondOrderId]
    );
    expect(
      secondSalesNotifications.rows.some(
        row =>
          row.internal_user_id === sales2Id &&
          row.status === 'pending' &&
          row.event_type === 'ORDER_CANCELLED'
      )
    ).toBe(true);
    expect(
      secondSalesNotifications.rows.some(row => row.internal_user_id === sales1Id)
    ).toBe(false);

    const preview = await admin.agent.get(
      `/api/admin/orders/impact?kind=product_unpublish&targetId=${item.productId}`
    );
    expect(preview.status).toBe(200);
    const unpublish = await post(
      admin.agent,
      `/api/admin/catalog/products/${item.productId}/unpublish`,
      {
        confirmAffectedOrders: true,
        impactToken: preview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(unpublish.status).toBe(200);

    const afterAdminCancel = await pool.query<{
      internal_user_id: string | null;
      status: string;
      event_type: string;
    }>(
      `SELECT internal_user_id, status, event_type FROM order_notifications
       WHERE order_id = $1 AND audience = 'sales' ORDER BY created_at, id`,
      [orderId]
    );
    expect(
      afterAdminCancel.rows.some(
        row =>
          row.internal_user_id === sales2Id &&
          row.status === 'pending' &&
          row.event_type === 'ORDER_CANCELLED_BY_ADMIN'
      )
    ).toBe(true);
    expect(
      afterAdminCancel.rows.some(
        row => row.internal_user_id === sales1Id && row.status === 'pending'
      )
    ).toBe(false);

    // Unassigning the company removes B's access and invalidates B's unsent rows.
    const unassigned = await patch(
      admin.agent,
      `/api/admin/companies/${company.companyId}/sales-assignment`,
      { salesUserId: null },
      admin.csrf
    );
    expect(unassigned.status).toBe(200);
    expect(
      (await sales2.agent.get('/api/sales/orders')).body.orders.map(
        (order: { id: string }) => order.id
      )
    ).not.toContain(orderId);
    expect((await sales2.agent.get(`/api/sales/orders/${orderId}`)).status).toBe(404);
    expect((await admin.agent.get(`/api/admin/orders/${orderId}`)).status).toBe(200);
    expect((await customer.agent.get(`/api/orders/${orderId}`)).status).toBe(200);
    const remainingSalesPending = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM order_notifications
       WHERE order_id = $1 AND audience = 'sales' AND status = 'pending'`,
      [orderId]
    );
    expect(remainingSalesPending.rows[0].count).toBe('0');
    // New events for an unassigned company must not revive its historic owner.
    expect((await setCart(customer, cancelItem.skuId, 10)).status).toBe(200);
    const unassignedOrder = await submit(customer);
    expect(unassignedOrder.status).toBe(201);
    const unassignedNotifications = await pool.query<{ audience: string; internal_user_id: string | null }>(
      'SELECT audience, internal_user_id FROM order_notifications WHERE order_id = $1',
      [unassignedOrder.body.order.id]
    );
    expect(unassignedNotifications.rows).toEqual([{ audience: 'customer', internal_user_id: null }]);

  }, 60_000);

  it('serialises an in-flight outbox insert with HTTP reassignment and cancels the former owner row', async () => {
    const { queueOrderNotifications } = await import('../../src/orders/notifications.js');
    const admin = await login('order.admin@example.test');
    const item = await createPublishedProduct(admin);
    const company = await createCompany({ assignedSalesUserId: sales1Id, letters: ['A'] });
    const customer = await login(company.customers[0].username);
    expect((await setCart(customer, item.skuId, 10)).status).toBe(200);
    const created = await submit(customer);
    expect(created.status).toBe(201);
    const client = await pool.connect();
    let reassignment: Promise<SupertestResponse> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await queueOrderNotifications(client, {
        orderId: created.body.order.id, orderNo: created.body.order.orderNo,
        companyId: company.companyId, companyCode: 'TEST', eventType: 'ORDER_MODIFIED',
        customerMessage: 'Customer change', salesMessage: 'Sales change',
      });
      reassignment = patch(admin.agent,
        `/api/admin/companies/${company.companyId}/sales-assignment`,
        { salesUserId: sales2Id }, admin.csrf).then(response => response);
      // Observe the actual PostgreSQL lock wait, not a scheduling delay.
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waiting = await pool.query<{ blocked: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked', [pid]
        );
        if (waiting.rows[0].blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query('COMMIT');
      expect((await reassignment).status).toBe(200);
      const rows = await pool.query<{ internal_user_id: string; status: string }>(
        `SELECT internal_user_id, status FROM order_notifications
         WHERE order_id = $1 AND audience = 'sales'`, [created.body.order.id]
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.every(row => row.internal_user_id === sales1Id && row.status === 'cancelled')).toBe(true);
      // Later events resolve B, rather than reviving cancelled events for A.
      await client.query('BEGIN');
      await queueOrderNotifications(client, {
        orderId: created.body.order.id, orderNo: created.body.order.orderNo,
        companyId: company.companyId, companyCode: 'TEST', eventType: 'ORDER_MODIFIED',
        customerMessage: 'Later change', salesMessage: 'Later change',
      });
      await client.query('COMMIT');
      const pending = await pool.query<{ internal_user_id: string }>(
        `SELECT internal_user_id FROM order_notifications
         WHERE order_id = $1 AND audience = 'sales' AND status = 'pending'`, [created.body.order.id]
      );
      expect(pending.rows).toEqual([{ internal_user_id: sales2Id }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (reassignment) await reassignment;
    }
  });

  it('runs cart and order writes through the least-privilege runtime role', async () => {
    const role = `aoking_runtime_orders_${process.pid}`;
    const rolePassword = 'RuntimeOrdersPass123!';
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
      await expect(
        runtimePool.query('CREATE TABLE runtime_orders_should_fail (id integer)')
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtimePool.query('DELETE FROM orders')
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtimePool.query('DELETE FROM order_items')
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtimePool.query('UPDATE inventory_balances SET reserved = 1')
      ).rejects.toThrow(/permission denied/i);

      const customerAgent = request.agent(runtimeApp);
      const customerToken = await csrf(customerAgent);
      const customerLogin = await customerAgent
        .post('/api/auth/login')
        .set('X-CSRF-Token', customerToken)
        .send({ username: 'AK000301A', password: PASSWORD });
      expect(customerLogin.status).toBe(200);

      const products = await customerAgent.get('/api/catalog/products');
      expect(products.status).toBe(200);
      const product = products.body.products[0];
      const skuId = product.skus[0].id as string;
      const cart = await customerAgent.get('/api/cart');
      const added = await put(
        customerAgent,
        `/api/cart/items/${skuId}`,
        { quantity: 10, expectedRevision: cart.body.cart.revision },
        customerToken
      );
      expect(added.status).toBe(200);
      const submitted = await post(
        customerAgent,
        '/api/orders',
        {
          idempotencyKey: randomUUID(),
          expectedCartRevision: added.body.cart.revision,
          ...delivery(),
        },
        customerToken
      );
      expect(submitted.status).toBe(201);
      expect(submitted.body.order.lines).toHaveLength(1);
      expect((await customerAgent.get('/api/orders')).status).toBe(200);

      const modified = await patch(
        customerAgent,
        `/api/orders/${submitted.body.order.id}/lines`,
        {
          expectedRevision: submitted.body.order.revision,
          lines: [{ skuId, quantity: 12 }],
        },
        customerToken
      );
      expect(modified.status).toBe(200);
      expect(modified.body.order.lines[0].quantity).toBe(12);

      const all = request.agent(runtimeApp);
      const adminToken = await csrf(all);
      const adminLogin = await all
        .post('/api/auth/login')
        .set('X-CSRF-Token', adminToken)
        .send({ username: 'order.admin@example.test', password: PASSWORD });
      expect(adminLogin.status).toBe(200);
      expect((await all.get('/api/admin/orders')).status).toBe(200);
      const reassigned = await patch(
        all,
        `/api/admin/companies/${companyAId}/sales-assignment`,
        { salesUserId: sales2Id },
        adminToken
      );
      expect(reassigned.status).toBe(200);
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
