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
    expect(order.orderNo).toMatch(/^OD[0-9]{10}$/);
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
      expect(orderNo).toMatch(/^OD[0-9]{10}$/);
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
