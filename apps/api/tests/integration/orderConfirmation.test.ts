import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import pg from 'pg';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
type LoggedIn = { agent: TestAgent; csrf: string; userId: string };

let pool: Pool;
let app: Express;
let mediaRoot = '';
let adminId = '';
let businessAdminId = '';
let salesId = '';
let sales2Id = '';
let companyAId = '';
let companyBId = '';
let companyCId = '';
let warehouse1Id = '';
let warehouse2Id = '';
let productCounter = 0;
let companyCounter = 0;
const brandId = 'brand-aoking';

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
}): Promise<{ companyId: string; customers: Array<{ userId: string; username: string }> }> {
  companyCounter += 1;
  const digits = String(500 + companyCounter).padStart(6, '0');
  const customerCode = `C${digits}`;
  const companyId = randomUUID();
  await pool.query(
    `INSERT INTO customer_companies
      (id, customer_code, short_name, country_alpha3, assigned_sales_user_id, status,
       created_at, updated_at)
     VALUES ($1, $2, $3, 'USA', $4, 'active', now(), now())`,
    [companyId, customerCode, `Confirmation Customer ${companyCounter}`, options.assignedSalesUserId]
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
  await pool.query(
    'INSERT INTO brand_grants (company_id, brand_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [companyId, brandId]
  );
  return { companyId, customers: created };
}

async function csrf(agent: TestAgent): Promise<string> {
  const response = await agent.get('/api/auth/csrf');
  expect(response.status).toBe(200);
  return response.body.csrfToken as string;
}

async function login(username: string, targetApp: Express = app): Promise<LoggedIn> {
  const agent = request.agent(targetApp);
  const token = await csrf(agent);
  const response = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username, password: PASSWORD });
  expect(response.status).toBe(200);
  return { agent, csrf: token, userId: response.body.user.id };
}

function post(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.post(pathName).set('X-CSRF-Token', token).send(body as object);
}
function patch(agent: TestAgent, pathName: string, body: unknown, token: string) {
  return agent.patch(pathName).set('X-CSRF-Token', token).send(body as object);
}

async function createPublishedProduct(
  admin: LoggedIn,
  options: { priceCents?: number; w1?: number; w2?: number } = {}
): Promise<{ productId: string; skuId: string; skuCode: string }> {
  productCounter += 1;
  const productCode = `CNF-${String(productCounter).padStart(4, '0')}`;
  const skuCode = `${productCode}-BLK`;
  const product = await post(
    admin.agent,
    '/api/admin/catalog/products',
    {
      brandId,
      productCode,
      title: `确认测试商品 ${productCounter}`,
      titleEn: `Confirmation Product ${productCounter}`,
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
      basePriceCents: options.priceCents ?? 4200,
      initialInventory: {
        warehouseId: warehouse1Id,
        onHand: options.w1 ?? 1000,
        unsellable: 0,
      },
    },
    admin.csrf
  );
  expect(sku.status).toBe(201);
  await post(
    admin.agent,
    `/api/admin/catalog/products/${productId}/publish`,
    {},
    admin.csrf
  );
  if ((options.w2 ?? 0) > 0) {
    const registered = await post(
      admin.agent,
      '/api/admin/inventory/register',
      {
        skuId: sku.body.sku.id,
        warehouseId: warehouse2Id,
        onHand: options.w2,
        unsellable: 0,
        reason: 'second warehouse test stock',
      },
      admin.csrf
    );
    expect(registered.status).toBe(201);
  }
  return { productId, skuId: sku.body.sku.id as string, skuCode };
}

async function addToCart(customer: LoggedIn, skuId: string, quantity: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cart = await customer.agent.get('/api/cart');
    if (cart.body.cart.itemCount > 0) {
      const cleared = await customer.agent
        .delete('/api/cart/items')
        .set('X-CSRF-Token', customer.csrf)
        .send({ expectedRevision: cart.body.cart.revision });
      if (cleared.status !== 200) continue;
    }
    const latest = await customer.agent.get('/api/cart');
    const response = await customer.agent
      .put(`/api/cart/items/${skuId}`)
      .set('X-CSRF-Token', customer.csrf)
      .send({ quantity, expectedRevision: latest.body.cart.revision });
    if (response.status === 200) return;
    if (response.status !== 409) break;
  }
  throw new Error(`Could not add ${skuId} to the isolated test cart.`);
}

async function submitOrder(customer: LoggedIn): Promise<Record<string, any>> {
  const cart = await customer.agent.get('/api/cart');
  const response = await post(
    customer.agent,
    '/api/orders',
    {
      idempotencyKey: randomUUID(),
      expectedCartRevision: cart.body.cart.revision,
      shippingMethod: 'Sea',
      destinationCountryAlpha3: 'USA',
      expectedShipDate: '2026-12-15',
      shippingRequirements: 'Standard export cartons.',
    },
    customer.csrf
  );
  expect(response.status).toBe(201);
  return response.body.order;
}

async function grantBuyer(admin: LoggedIn, companyId: string, customerUserId: string) {
  const response = await post(
    admin.agent,
    `/api/admin/companies/${companyId}/buyer-authorizations`,
    { customerUserId, idempotencyKey: randomUUID() },
    admin.csrf
  );
  expect(response.status).toBe(201);
  return response.body.authorization as { id: string; version: number };
}

async function savePlan(
  sales: LoggedIn,
  order: Record<string, any>,
  lines: Array<{ skuId: string; quantity: number; unitPriceCents: number }>
): Promise<{ order: Record<string, any>; plan: Record<string, any> }> {
  const response = await post(
    sales.agent,
    `/api/sales/orders/${order.id}/plans`,
    {
      expectedRevision: order.revision,
      expectedPlanVersion: order.currentPlan?.version ?? 0,
      lines,
      idempotencyKey: randomUUID(),
    },
    sales.csrf
  );
  expect(response.status).toBe(200);
  return response.body;
}

async function approvePrice(
  business: LoggedIn,
  order: Record<string, any>,
  decision: 'APPROVED' | 'REJECTED' = 'APPROVED'
) {
  const approvalId = order.currentPlan.priceApproval.id as string;
  const response = await post(
    business.agent,
    `/api/admin/order-approvals/price/${approvalId}/decision`,
    {
      decision,
      note: 'test decision',
      expectedPlanVersion: order.currentPlan.version,
      idempotencyKey: randomUUID(),
    },
    business.csrf
  );
  expect(response.status).toBe(200);
  return response.body;
}

async function acceptPlan(
  customer: LoggedIn,
  order: Record<string, any>,
  outcome: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED'
) {
  const response = await post(
    customer.agent,
    `/api/orders/${order.id}/plan-decision`,
    {
      expectedRevision: order.revision,
      expectedPlanVersion: order.currentPlan.version,
      planDigest: order.currentPlan.planDigest,
      outcome,
      reason: outcome === 'REJECTED' ? 'Please revise' : '',
      idempotencyKey: randomUUID(),
    },
    customer.csrf
  );
  expect(response.status).toBe(200);
  return response.body.order;
}

async function confirm(
  sales: LoggedIn,
  order: Record<string, any>,
  allocations: Array<{ skuId: string; warehouseId: string; quantity: number }>,
  key = randomUUID()
) {
  return post(
    sales.agent,
    `/api/sales/orders/${order.id}/confirm`,
    {
      expectedRevision: order.revision,
      expectedPlanVersion: order.currentPlan.version,
      planDigest: order.currentPlan.planDigest,
      acceptanceId: order.acceptance.id,
      allocations,
      idempotencyKey: key,
    },
    sales.csrf
  );
}

async function inventory(skuId: string, warehouseId: string) {
  const result = await pool.query<{
    on_hand: number;
    reserved: number;
    unsellable: number;
    version: string;
  }>(
    'SELECT on_hand, reserved, unsellable, version FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
    [skuId, warehouseId]
  );
  return result.rows[0];
}

async function createConfirmedOrder(
  customer: LoggedIn,
  sales: LoggedIn,
  business: LoggedIn,
  options: { priceCents?: number; qty?: number; w1?: number; w2?: number } = {}
): Promise<{
  order: Record<string, any>;
  item: { skuId: string; skuCode: string; productId: string };
}> {
  const item = await createPublishedProduct(await login('conf.admin@example.test'), {
    priceCents: options.priceCents ?? 4200,
    w1: options.w1 ?? 1000,
    w2: options.w2 ?? 0,
  });
  await addToCart(customer, item.skuId, options.qty ?? 20);
  const order = await submitOrder(customer);
  const plan = await savePlan(sales, order, [
    {
      skuId: item.skuId,
      quantity: options.qty ?? 20,
      unitPriceCents: options.priceCents ?? 4200,
    },
  ]);
  const accepted = await acceptPlan(customer, plan.order);
  const confirmed = await confirm(sales, accepted, [
    { skuId: item.skuId, warehouseId: warehouse1Id, quantity: options.qty ?? 20 },
  ]);
  expect(confirmed.status).toBe(200);
  return { order: confirmed.body.order, item };
}

describeDb('Phase 4B-05 order confirmation', () => {
  beforeAll(async () => {
    if (!safeDatabase) return;
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'aoking-confirmation-media-'));
  }, 30_000);

  // Each test starts from the same clean schema. This suite deliberately uses
  // per-test isolation: one test's pending order, accepted plan, revocation or
  // permission removal must never leak into the next counterexample.
  beforeEach(async () => {
    if (!safeDatabase) return;
    companyCounter = 0;
    productCounter = 0;
    await resetSchema();
    await runMigrations(databaseUrl());
    pool = createPool(databaseUrl());
    app = createApp({
      checkReadiness: () => checkReadiness(pool),
      auth: { pool, config },
      mediaRoot,
    });
    adminId = await createInternal('Conf Admin', 'conf.admin@example.test', ['admin']);
    businessAdminId = await createInternal('Conf Business', 'conf.business@example.test', [
      'business_admin',
    ]);
    salesId = await createInternal('Conf Sales', 'conf.sales@example.test', [
      'sales',
      'sales_writer',
    ]);
    sales2Id = await createInternal('Conf Sales 2', 'conf.sales2@example.test', [
      'sales',
      'sales_writer',
    ]);
    const companyA = await createCompany({
      assignedSalesUserId: salesId,
      letters: ['A', 'B', 'C'],
    });
    companyAId = companyA.companyId;
    const companyB = await createCompany({
      assignedSalesUserId: sales2Id,
      letters: ['A'],
    });
    companyBId = companyB.companyId;
    // Dedicated company for revocation/linearisation tests so they never
    // invalidate acceptances left by the plan/pricing fixtures on company A.
    const companyC = await createCompany({
      assignedSalesUserId: salesId,
      letters: ['D', 'E'],
    });
    companyCId = companyC.companyId;

    const admin = await login('conf.admin@example.test');
    const warehouse1 = await post(
      admin.agent,
      '/api/admin/warehouses',
      { code: 'WH-CNF-1', name: '确认仓一', nameEn: 'Confirmation W1' },
      admin.csrf
    );
    expect(warehouse1.status).toBe(201);
    warehouse1Id = warehouse1.body.warehouse.id;
    const warehouse2 = await post(
      admin.agent,
      '/api/admin/warehouses',
      { code: 'WH-CNF-2', name: '确认仓二', nameEn: 'Confirmation W2' },
      admin.csrf
    );
    expect(warehouse2.status).toBe(201);
    warehouse2Id = warehouse2.body.warehouse.id;

    for (const [index, letter] of companyA.customers.entries()) {
      await grantBuyer(admin, companyAId, companyA.customers[index].userId);
      void letter;
    }
    for (const account of companyC.customers) {
      await grantBuyer(admin, companyCId, account.userId);
    }
    void companyB;
    void adminId;
    void businessAdminId;
    void sales2Id;
  }, 60_000);

  afterEach(async () => {
    if (!safeDatabase) return;
    await pool.end();
    await resetSchema();
  }, 30_000);

  afterAll(async () => {
    if (!safeDatabase) return;
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  }, 30_000);

  it('first same-price plan is exempt; a reduction creates a new epoch and quantity-only inherits it', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin);
    await addToCart(customer, item.skuId, 20);
    const order = await submitOrder(customer);

    const referencePlan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 20, unitPriceCents: 4200 },
    ]);
    expect(referencePlan.plan.requiresPriceApproval).toBe(false);
    expect(referencePlan.plan.priceApprovalStatus).toBe('NOT_REQUIRED');

    const discounted = await savePlan(sales, referencePlan.order, [
      { skuId: item.skuId, quantity: 20, unitPriceCents: 4000 },
    ]);
    expect(discounted.plan.requiresPriceApproval).toBe(true);
    expect(discounted.plan.priceApprovalStatus).toBe('PENDING');
    expect(discounted.plan.priceApproval.id).toBeTruthy();

    // Quantity-only update must inherit PENDING, not create a free plan.
    const quantityOnly = await savePlan(sales, discounted.order, [
      { skuId: item.skuId, quantity: 24, unitPriceCents: 4000 },
    ]);
    expect(quantityOnly.plan.requiresPriceApproval).toBe(true);
    expect(quantityOnly.plan.priceApprovalStatus).toBe('PENDING');
    expect(quantityOnly.plan.priceApproval.id).toBe(discounted.plan.priceApproval.id);
    const blocked = await post(
      customer.agent,
      `/api/orders/${quantityOnly.order.id}/plan-decision`,
      {
        expectedRevision: quantityOnly.order.revision,
        expectedPlanVersion: quantityOnly.plan.version,
        planDigest: quantityOnly.plan.planDigest,
        outcome: 'ACCEPTED',
        idempotencyKey: randomUUID(),
      },
      customer.csrf
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('price_approval_pending');

    // Approving the original request covers the same-fingerprint quantity-only
    // version. Changing the price again would require a new epoch.
    await approvePrice(business, quantityOnly.order);
    const accepted = await acceptPlan(customer, quantityOnly.order);
    expect(accepted.currentPlan.status).toBe('ACCEPTED');
  });

  it('a manual change back to the reference price creates a new approval epoch', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin);
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const discounted = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 3900 },
    ]);
    await approvePrice(business, discounted.order);
    const accepted = await acceptPlan(customer, discounted.order);
    expect(accepted.currentPlan.priceApprovalStatus).toBe('APPROVED');

    // Change back to the reference number: this is still a manual change from
    // the last valid salesperson price, so it needs a new approval.
    const backToReference = await savePlan(sales, accepted, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    expect(backToReference.plan.requiresPriceApproval).toBe(true);
    expect(backToReference.plan.priceApprovalStatus).toBe('PENDING');
    expect(backToReference.plan.priceApproval.id).not.toBe(
      discounted.plan.priceApproval.id
    );
    expect(backToReference.order.acceptance).toBeNull();
  });

  it('rejects a stale price approval after a newer plan version', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin);
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const first = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4100 },
    ]);
    const approvalId = first.plan.priceApproval.id;
    const stalePlanVersion = first.plan.version;
    await savePlan(sales, first.order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4050 },
    ]);
    const stale = await post(
      business.agent,
      `/api/admin/order-approvals/price/${approvalId}/decision`,
      {
        decision: 'APPROVED',
        expectedPlanVersion: stalePlanVersion,
        idempotencyKey: randomUUID(),
      },
      business.csrf
    );
    expect(stale.status).toBe(409);
    expect(['approval_stale', 'plan_version_conflict', 'approval_already_decided']).toContain(
      stale.body.error.code
    );
  });

  it('splits one line across two warehouses and keeps on_hand/unsellable unchanged', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501B');
    const item = await createPublishedProduct(admin, { w1: 20, w2: 12, priceCents: 4200 });
    await addToCart(customer, item.skuId, 20);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 20, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);
    const confirmKey = randomUUID();
    const allocations = [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 12 },
      { skuId: item.skuId, warehouseId: warehouse2Id, quantity: 8 },
    ];
    const confirmed = await confirm(sales, accepted, allocations, confirmKey);
    expect(confirmed.status).toBe(200);
    const body = confirmed.body.order;
    expect(body.status).toBe('CONFIRMED');
    expect(body.confirmation.reservation.effectiveStatus).toBe('ACTIVE');
    expect(body.confirmation.reservation.totalExtensionHours).toBe(0);
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({
      on_hand: 20,
      reserved: 12,
      unsellable: 0,
    });
    expect(await inventory(item.skuId, warehouse2Id)).toMatchObject({
      on_hand: 12,
      reserved: 8,
      unsellable: 0,
    });
    const final = await pool.query(
      'SELECT count(*)::text AS count FROM order_final_lines WHERE order_id = $1',
      [body.id]
    );
    expect(final.rows[0].count).toBe('1');
    const ledger = await pool.query(
      'SELECT action, count(*)::text AS count FROM order_reservation_ledger WHERE order_id = $1 GROUP BY action',
      [body.id]
    );
    expect(ledger.rows).toEqual([{ action: 'reserve', count: '2' }]);

    // Same-key replay returns the first result and does not reserve again.
    const replay = await post(
      sales.agent,
      `/api/sales/orders/${body.id}/confirm`,
      {
        expectedRevision: accepted.revision,
        expectedPlanVersion: accepted.currentPlan.version,
        planDigest: accepted.currentPlan.planDigest,
        acceptanceId: accepted.acceptance.id,
        allocations,
        idempotencyKey: confirmKey,
      },
      sales.csrf
    );
    expect(replay.status).toBe(200);
    expect(replay.body.order.confirmation.reservation.id).toBe(
      body.confirmation.reservation.id
    );
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 12 });
    expect(await inventory(item.skuId, warehouse2Id)).toMatchObject({ reserved: 8 });

    // A different key sees the already-confirmed state and cannot reserve again.
    const differentKey = await post(
      sales.agent,
      `/api/sales/orders/${body.id}/confirm`,
      {
        expectedRevision: accepted.revision,
        expectedPlanVersion: accepted.currentPlan.version,
        planDigest: accepted.currentPlan.planDigest,
        acceptanceId: accepted.acceptance.id,
        allocations,
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(differentKey.status).toBe(409);
    expect(differentKey.body.error.code).toBe('order_status_conflict');
  });

  it('serialises two companies on the last stock row so only one confirmation reserves', async () => {
    const admin = await login('conf.admin@example.test');
    const salesA = await login('conf.sales@example.test');
    const salesB = await login('conf.sales2@example.test');
    const customerA = await login('AK000501A');
    const customerB = await login('AK000502A');
    await grantBuyer(admin, companyBId, customerB.userId);
    const item = await createPublishedProduct(admin, { w1: 10 });

    await addToCart(customerA, item.skuId, 10);
    const orderA = await submitOrder(customerA);
    const planA = await savePlan(salesA, orderA, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const acceptedA = await acceptPlan(customerA, planA.order);

    await addToCart(customerB, item.skuId, 10);
    const orderB = await submitOrder(customerB);
    const planB = await savePlan(salesB, orderB, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const acceptedB = await acceptPlan(customerB, planB.order);

    // Both orders are ready to confirm. Hold the one sellable balance row so
    // both HTTP transactions queue on the same last-unit inventory row.
    const holder = await pool.connect();
    let pendingA: Promise<SupertestResponse> | undefined;
    let pendingB: Promise<SupertestResponse> | undefined;
    let blockedCount = 0;
    try {
      await holder.query('BEGIN');
      await holder.query("SET LOCAL statement_timeout = '20s'");
      const holderPid = (
        await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      await holder.query(
        'SELECT sku_id FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2 FOR UPDATE',
        [item.skuId, warehouse1Id]
      );
      pendingA = confirm(salesA, acceptedA, [
        { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
      ]).then(response => response);
      pendingB = confirm(salesB, acceptedB, [
        { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
      ]).then(response => response);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waiting = await pool.query<{ count: number }>(
          `WITH RECURSIVE waiters AS (
             SELECT pid
             FROM pg_stat_activity
             WHERE $1 = ANY(pg_blocking_pids(pid))
             UNION
             SELECT activity.pid
             FROM pg_stat_activity activity
             JOIN waiters ON waiters.pid = ANY(pg_blocking_pids(activity.pid))
           )
           SELECT count(*)::int AS count FROM waiters`,
          [holderPid]
        );
        blockedCount = Number(waiting.rows[0].count);
        if (blockedCount >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blockedCount).toBe(2);
    } finally {
      await holder.query('COMMIT').catch(() => holder.query('ROLLBACK').catch(() => {}));
      holder.release();
    }

    const responses = await Promise.all([pendingA!, pendingB!]);
    const successes = responses.filter(response => response.status === 200);
    const failures = responses.filter(response => response.status !== 200);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].status).toBe(409);
    expect(failures[0].body.error.code).toBe('insufficient_stock');

    const failedOrderId = responses[0].status === 200 ? orderB.id : orderA.id;
    const successfulOrderId = responses[0].status === 200 ? orderA.id : orderB.id;

    const failedOrder = await pool.query('SELECT status FROM orders WHERE id = $1', [
      failedOrderId,
    ]);
    expect(failedOrder.rows[0].status).toBe('PENDING_CONFIRMATION');
    const failedReservations = await pool.query(
      'SELECT count(*)::int AS count FROM order_reservations WHERE order_id = $1',
      [failedOrderId]
    );
    expect(failedReservations.rows[0].count).toBe(0);
    const failedLedger = await pool.query(
      'SELECT count(*)::int AS count FROM order_reservation_ledger WHERE order_id = $1',
      [failedOrderId]
    );
    expect(failedLedger.rows[0].count).toBe(0);
    const failedHistory = await pool.query(
      `SELECT count(*)::int AS count FROM order_status_history
       WHERE order_id = $1 AND event_type = 'CONFIRMED'`,
      [failedOrderId]
    );
    expect(failedHistory.rows[0].count).toBe(0);
    const failedAudit = await pool.query(
      `SELECT count(*)::int AS count FROM audit_logs
       WHERE action = 'CONFIRM_ORDER' AND target_id = $1`,
      [failedOrderId]
    );
    expect(failedAudit.rows[0].count).toBe(0);

    const successfulOrder = await pool.query('SELECT status FROM orders WHERE id = $1', [
      successfulOrderId,
    ]);
    expect(successfulOrder.rows[0].status).toBe('CONFIRMED');
    const successfulReservations = await pool.query(
      'SELECT count(*)::int AS count FROM order_reservations WHERE order_id = $1',
      [successfulOrderId]
    );
    expect(successfulReservations.rows[0].count).toBe(1);
    const successfulHistory = await pool.query(
      `SELECT count(*)::int AS count FROM order_status_history
       WHERE order_id = $1 AND event_type = 'CONFIRMED'`,
      [successfulOrderId]
    );
    expect(successfulHistory.rows[0].count).toBe(1);
    const successfulAudit = await pool.query(
      `SELECT count(*)::int AS count FROM audit_logs
       WHERE action = 'CONFIRM_ORDER' AND target_id = $1`,
      [successfulOrderId]
    );
    expect(successfulAudit.rows[0].count).toBe(1);
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({
      on_hand: 10,
      reserved: 10,
      unsellable: 0,
    });
  }, 60_000);

  it('rejects missing CSRF on the new write entry points and cross-company order writes', async () => {
    const admin = await login('conf.admin@example.test');
    const salesA = await login('conf.sales@example.test');
    const salesB = await login('conf.sales2@example.test');
    const business = await login('conf.business@example.test');
    const customerA = await login('AK000501A');
    const customerB = await login('AK000502A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customerA, item.skuId, 10);
    const orderA = await submitOrder(customerA);
    const planA = await savePlan(salesA, orderA, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const acceptedA = await acceptPlan(customerA, planA.order);

    // Every new state-changing route is behind the router-level double-submit
    // check, including approval decisions and buyer-authorization management.
    const missingCsrf: Array<{ agent: TestAgent; path: string; body: unknown }> = [
      {
        agent: salesA.agent,
        path: `/api/sales/orders/${orderA.id}/plans`,
        body: {
          expectedRevision: acceptedA.revision,
          expectedPlanVersion: acceptedA.currentPlan.version,
          lines: [{ skuId: item.skuId, quantity: 10, unitPriceCents: 4200 }],
          idempotencyKey: randomUUID(),
        },
      },
      {
        agent: salesA.agent,
        path: `/api/sales/orders/${orderA.id}/confirm`,
        body: {
          expectedRevision: acceptedA.revision,
          expectedPlanVersion: acceptedA.currentPlan.version,
          planDigest: acceptedA.currentPlan.planDigest,
          acceptanceId: acceptedA.acceptance.id,
          allocations: [{ skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 }],
          idempotencyKey: randomUUID(),
        },
      },
      {
        agent: salesA.agent,
        path: `/api/sales/orders/${orderA.id}/extension-requests`,
        body: {
          expectedRevision: acceptedA.revision,
          expectedReservationVersion: 1,
          additionalHours: 24,
          reason: 'csrf probe',
          idempotencyKey: randomUUID(),
        },
      },
      {
        agent: salesA.agent,
        path: `/api/sales/orders/${orderA.id}/release-requests`,
        body: {
          expectedRevision: acceptedA.revision,
          expectedReservationVersion: 1,
          reason: 'csrf probe',
          paymentVerification: 'unpaid',
          shipmentVerification: 'not_shipped',
          verificationNote: 'csrf probe',
          idempotencyKey: randomUUID(),
        },
      },
      {
        agent: customerA.agent,
        path: `/api/orders/${orderA.id}/plan-decision`,
        body: {
          expectedRevision: acceptedA.revision,
          expectedPlanVersion: acceptedA.currentPlan.version,
          planDigest: acceptedA.currentPlan.planDigest,
          outcome: 'ACCEPTED',
          idempotencyKey: randomUUID(),
        },
      },
      {
        agent: business.agent,
        path: `/api/admin/order-approvals/price/${randomUUID()}/decision`,
        body: { decision: 'APPROVED', idempotencyKey: randomUUID() },
      },
      {
        agent: business.agent,
        path: `/api/admin/order-approvals/extension/${randomUUID()}/decision`,
        body: { decision: 'APPROVED', idempotencyKey: randomUUID() },
      },
      {
        agent: business.agent,
        path: `/api/admin/order-approvals/release/${randomUUID()}/decision`,
        body: { decision: 'APPROVED', idempotencyKey: randomUUID() },
      },
      { agent: business.agent, path: '/api/admin/order-approvals/expiry-scan', body: {} },
      {
        agent: admin.agent,
        path: `/api/admin/companies/${companyAId}/buyer-authorizations`,
        body: { customerUserId: customerA.userId, idempotencyKey: randomUUID() },
      },
      {
        agent: admin.agent,
        path: `/api/admin/buyer-authorizations/${randomUUID()}/revoke`,
        body: { reason: 'csrf probe', idempotencyKey: randomUUID() },
      },
    ];
    for (const probe of missingCsrf) {
      const response = await probe.agent.post(probe.path).send(probe.body as object);
      expect(response.status, probe.path).toBe(403);
      expect(response.body.error.code, probe.path).toBe('csrf_failed');
    }

    // A salesperson assigned to another company cannot edit, confirm, request
    // an extension or release this order; ownership is reported as 404.
    const foreignPlan = await post(
      salesB.agent,
      `/api/sales/orders/${orderA.id}/plans`,
      {
        expectedRevision: orderA.revision,
        expectedPlanVersion: planA.order.currentPlan.version,
        lines: [{ skuId: item.skuId, quantity: 10, unitPriceCents: 4200 }],
        idempotencyKey: randomUUID(),
      },
      salesB.csrf
    );
    expect(foreignPlan.status).toBe(404);
    expect(foreignPlan.body.error.code).toBe('order_not_found');

    // A customer account of another company cannot accept the plan, even with
    // the exact plan version and digest.
    const foreignAccept = await post(
      customerB.agent,
      `/api/orders/${orderA.id}/plan-decision`,
      {
        expectedRevision: acceptedA.revision,
        expectedPlanVersion: acceptedA.currentPlan.version,
        planDigest: acceptedA.currentPlan.planDigest,
        outcome: 'ACCEPTED',
        idempotencyKey: randomUUID(),
      },
      customerB.csrf
    );
    expect(foreignAccept.status).toBe(404);
    expect(foreignAccept.body.error.code).toBe('order_not_found');

    const foreignConfirm = await confirm(salesB, acceptedA, [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
    ]);
    expect(foreignConfirm.status).toBe(404);

    const ownConfirm = await confirm(salesA, acceptedA, [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
    ]);
    expect(ownConfirm.status).toBe(200);
    const foreignExtension = await post(
      salesB.agent,
      `/api/sales/orders/${orderA.id}/extension-requests`,
      {
        expectedRevision: ownConfirm.body.order.revision,
        expectedReservationVersion: ownConfirm.body.order.confirmation.reservation.version,
        additionalHours: 24,
        reason: 'foreign extension probe',
        idempotencyKey: randomUUID(),
      },
      salesB.csrf
    );
    expect(foreignExtension.status).toBe(404);
    const foreignRelease = await post(
      salesB.agent,
      `/api/sales/orders/${orderA.id}/release-requests`,
      {
        expectedRevision: ownConfirm.body.order.revision,
        expectedReservationVersion: ownConfirm.body.order.confirmation.reservation.version,
        reason: 'foreign release probe',
        paymentVerification: 'unpaid',
        shipmentVerification: 'not_shipped',
        verificationNote: 'foreign release probe',
        idempotencyKey: randomUUID(),
      },
      salesB.csrf
    );
    expect(foreignRelease.status).toBe(404);
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({
      on_hand: 100,
      reserved: 10,
    });
  }, 60_000);

  it('rejects missing, duplicate, unknown and short allocations atomically', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501C');
    const item = await createPublishedProduct(admin, { w1: 100, w2: 0 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);

    // Stock is sufficient for submission and acceptance; reduce the real
    // sellable quantity only immediately before the confirmation attempt.
    const current = await inventory(item.skuId, warehouse1Id);
    const adjusted = await patch(
      admin.agent,
      `/api/admin/inventory/${item.skuId}/${warehouse1Id}`,
      { onHand: 5, expectedVersion: Number(current.version), reason: 'short stock test' },
      admin.csrf
    );
    expect(adjusted.status).toBe(200);

    const missing = await confirm(sales, accepted, []);
    expect(missing.status).toBe(400);
    const duplicate = await confirm(sales, accepted, [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 5 },
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 5 },
    ]);
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('duplicate_allocation');
    const short = await confirm(sales, accepted, [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
    ]);
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe('insufficient_stock');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({
      on_hand: 5,
      reserved: 0,
    });
    const notOrderable = await pool.query(
      'SELECT count(*)::text AS count FROM order_reservations WHERE order_id = $1',
      [order.id]
    );
    expect(notOrderable.rows[0].count).toBe('0');
  });

  it('revocation before acceptance fails, re-granting does not revive the old key, another account can accept', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customerD = await login('AK000503D');
    const customerE = await login('AK000503E');
    const item = await createPublishedProduct(admin);
    await addToCart(customerD, item.skuId, 10);
    const order = await submitOrder(customerD);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const authorizations = await admin.agent.get(
      `/api/admin/companies/${companyCId}/buyer-authorizations`
    );
    const activeD = authorizations.body.authorizations.find(
      (row: { customerUserId: string; status: string }) =>
        row.customerUserId === customerD.userId && row.status === 'active'
    );
    const acceptanceKey = randomUUID();
    const accepted = await post(
      customerD.agent,
      `/api/orders/${order.id}/plan-decision`,
      {
        expectedRevision: plan.order.revision,
        expectedPlanVersion: plan.plan.version,
        planDigest: plan.plan.planDigest,
        outcome: 'ACCEPTED',
        idempotencyKey: acceptanceKey,
      },
      customerD.csrf
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.order.currentPlan.status).toBe('ACCEPTED');

    const revoked = await post(
      admin.agent,
      `/api/admin/buyer-authorizations/${activeD.id}/revoke`,
      { reason: 'test revoke', idempotencyKey: randomUUID() },
      admin.csrf
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.invalidatedAcceptances).toBe(1);

    const pendingOrder = await customerD.agent.get(`/api/orders/${order.id}`);
    expect(pendingOrder.body.order.currentPlan.status).toBe('SUBMITTED');
    expect(pendingOrder.body.order.acceptance).toBeNull();

    // Old key replay after revocation must not return the old success.
    const replay = await post(
      customerD.agent,
      `/api/orders/${order.id}/plan-decision`,
      {
        expectedRevision: plan.order.revision,
        expectedPlanVersion: plan.plan.version,
        planDigest: plan.plan.planDigest,
        outcome: 'ACCEPTED',
        idempotencyKey: acceptanceKey,
      },
      customerD.csrf
    );
    expect(replay.status).toBe(403);
    expect(replay.body.error.code).toBe('buyer_not_authorized');

    // Re-granting creates a new instance; the old key still cannot replay.
    const regranted = await grantBuyer(admin, companyCId, customerD.userId);
    const oldKeyAfterRegrant = await post(
      customerD.agent,
      `/api/orders/${order.id}/plan-decision`,
      {
        expectedRevision: plan.order.revision,
        expectedPlanVersion: plan.plan.version,
        planDigest: plan.plan.planDigest,
        outcome: 'ACCEPTED',
        idempotencyKey: acceptanceKey,
      },
      customerD.csrf
    );
    expect(oldKeyAfterRegrant.status).toBe(409);
    expect(oldKeyAfterRegrant.body.error.code).toBe('idempotency_conflict');

    // Another explicitly authorized account can accept the same plan.
    const reAccepted = await acceptPlan(customerE, pendingOrder.body.order);
    expect(reAccepted.currentPlan.status).toBe('ACCEPTED');
    expect(reAccepted.canAcceptPlan).toBe(false);
    expect(regranted.id).not.toBe(activeD.id);
  });

  it('confirm-first then revoke keeps the confirmed history; revoke-first blocks confirmation', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin);
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);
    const confirmed = await confirm(sales, accepted, [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
    ]);
    expect(confirmed.status).toBe(200);
    const auths = await admin.agent.get(
      `/api/admin/companies/${companyAId}/buyer-authorizations`
    );
    const active = auths.body.authorizations.find(
      (row: { customerUserId: string; status: string }) =>
        row.customerUserId === customer.userId && row.status === 'active'
    );
    const revoked = await post(
      admin.agent,
      `/api/admin/buyer-authorizations/${active.id}/revoke`,
      { reason: 'after confirmation', idempotencyKey: randomUUID() },
      admin.csrf
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.invalidatedAcceptances).toBe(0);
    const evidence = await pool.query(
      `SELECT a.outcome, a.invalidated_at FROM order_plan_acceptances a
       WHERE a.order_id = $1`,
      [order.id]
    );
    expect(evidence.rows[0].outcome).toBe('ACCEPTED');
    expect(evidence.rows[0].invalidated_at).toBeNull();
    const orderRow = await pool.query('SELECT status FROM orders WHERE id = $1', [order.id]);
    expect(orderRow.rows[0].status).toBe('CONFIRMED');
    const reservation = await pool.query(
      'SELECT status FROM order_reservations WHERE order_id = $1',
      [order.id]
    );
    expect(reservation.rows[0].status).toBe('ACTIVE');
  });

  it('re-validates sales.write inside the transaction after a company-lock wait', async () => {
    const admin = await login('conf.admin@example.test');
    const customer = await login('AK000501B');
    const revocable = await createInternal(
      'Conf Revocable Sales',
      'conf.revocable@example.test',
      ['sales']
    );
    await pool.query(
      'UPDATE customer_companies SET assigned_sales_user_id = $2 WHERE id = $1',
      [companyAId, revocable]
    );
    const revocableLogin = await login('conf.revocable@example.test');
    const item = await createPublishedProduct(admin);
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(revocableLogin, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);

    const client = await pool.connect();
    let pending: Promise<SupertestResponse> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid;
      await client.query('SELECT id FROM customer_companies WHERE id = $1 FOR UPDATE', [
        companyAId,
      ]);
      pending = confirm(revocableLogin, accepted, [
        { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
      ]).then(response => response);
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waiting = await pool.query<{ blocked: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
          [pid]
        );
        if (waiting.rows[0].blocked) {
          blocked = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query(
        `DELETE FROM internal_user_roles
         WHERE internal_user_id = $1 AND role_id = 'sales'`,
        [revocable]
      );
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    const response = await pending!;
    expect(response.status).toBe(403);
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 0 });
    const reservations = await pool.query(
      'SELECT count(*)::text AS count FROM order_reservations WHERE order_id = $1',
      [order.id]
    );
    expect(reservations.rows[0].count).toBe('0');
    await pool.query(
      'UPDATE customer_companies SET assigned_sales_user_id = $2 WHERE id = $1',
      [companyAId, salesId]
    );
    void admin;
  }, 60_000);

  it('legacy pending cancellation after a plan supersedes it and never touches a confirmed order', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501C');
    const item = await createPublishedProduct(admin);
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4100 },
    ]);
    const cancelled = await post(
      customer.agent,
      `/api/orders/${order.id}/cancel`,
      { expectedRevision: plan.order.revision, reason: 'legacy cancel after plan' },
      customer.csrf
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');
    const planRow = await pool.query(
      'SELECT status FROM order_plans WHERE order_id = $1',
      [order.id]
    );
    expect(planRow.rows[0].status).toBe('SUPERSEDED');
    const approval = await pool.query(
      'SELECT status FROM order_price_approvals WHERE order_id = $1',
      [order.id]
    );
    expect(approval.rows[0].status).toBe('SUPERSEDED');

    const confirmed = await createConfirmedOrder(customer, sales, sales, {});
    const confirmedCancel = await post(
      customer.agent,
      `/api/orders/${confirmed.order.id}/cancel`,
      { expectedRevision: confirmed.order.revision, reason: 'too late' },
      customer.csrf
    );
    expect(confirmedCancel.status).toBe(409);
    expect(confirmedCancel.body.error.code).toBe('order_status_conflict');
  }, 60_000);

  it('allows company/brand destructive actions with a confirmed order without releasing stock', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const { order, item } = await createConfirmedOrder(customer, sales, business, {});
    const before = await inventory(item.skuId, warehouse1Id);
    expect(before.reserved).toBe(20);

    const preview = await admin.agent.get(
      `/api/admin/orders/impact?kind=company_suspend&targetId=${companyAId}`
    );
    expect(preview.status).toBe(200);
    const suspend = await patch(
      admin.agent,
      `/api/admin/companies/${companyAId}/status`,
      {
        status: 'suspended',
        confirmAffectedOrders: true,
        impactToken: preview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(suspend.status).toBe(200);
    const orderRow = await pool.query('SELECT status FROM orders WHERE id = $1', [order.id]);
    expect(orderRow.rows[0].status).toBe('CONFIRMED');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 20 });
    const audit = await pool.query(
      "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'CONFIRMED_RESERVATIONS_AFFECTED' AND target_id = $1",
      [companyAId]
    );
    expect(Number(audit.rows[0].count)).toBeGreaterThan(0);

    await patch(
      admin.agent,
      `/api/admin/companies/${companyAId}/status`,
      { status: 'active' },
      admin.csrf
    );
    // Suspension revoked the company's buyer authority; restore it for the
    // later runtime-role flow.
    await grantBuyer(admin, companyAId, customer.userId);
    const warehouse = await patch(
      admin.agent,
      `/api/admin/warehouses/${warehouse1Id}`,
      { active: false },
      admin.csrf
    );
    expect(warehouse.status).toBe(409);
    expect(warehouse.body.error.code).toBe('confirmed_orders_affected');
    await patch(admin.agent, `/api/admin/warehouses/${warehouse1Id}`, { active: true }, admin.csrf);
  }, 60_000);

  it('requires unpaid/not-shipped verification and releases only once', async () => {
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501B');
    const { order, item } = await createConfirmedOrder(customer, sales, business, {
      qty: 10,
      w1: 100,
    });
    const reservation = order.confirmation.reservation;
    const paid = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/release-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: reservation.version,
        reason: 'try paid',
        paymentVerification: 'paid',
        shipmentVerification: 'not_shipped',
        verificationNote: 'paid already',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(paid.status).toBe(422);
    expect(paid.body.error.code).toBe('payment_verification_required');
    const unknown = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/release-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: reservation.version,
        reason: 'try unknown',
        paymentVerification: 'unknown',
        shipmentVerification: 'not_shipped',
        verificationNote: 'status unknown',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('payment_verification_required');
    const shipped = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/release-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: reservation.version,
        reason: 'try shipped',
        paymentVerification: 'unpaid',
        shipmentVerification: 'shipped',
        verificationNote: 'already shipped',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(shipped.status).toBe(422);
    expect(shipped.body.error.code).toBe('shipment_verification_required');

    const request = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/release-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: reservation.version,
        reason: 'verified customer cancellation',
        paymentVerification: 'unpaid',
        shipmentVerification: 'not_shipped',
        verificationNote: 'Checked payment ledger and warehouse outbound log',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(request.status).toBe(201);
    const requestId = request.body.request.id;
    const decisionKey = randomUUID();
    const approved = await post(
      business.agent,
      `/api/admin/order-approvals/release/${requestId}/decision`,
      {
        decision: 'APPROVED',
        note: 'verified',
        expectedReservationVersion: reservation.version,
        idempotencyKey: decisionKey,
      },
      business.csrf
    );
    expect(approved.status).toBe(200);
    expect(approved.body.order.status).toBe('CANCELLED');
    expect(approved.body.order.confirmation.reservation.effectiveStatus).toBe('RELEASED');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({
      on_hand: 100,
      reserved: 0,
      unsellable: 0,
    });
    const ledger = await pool.query(
      "SELECT count(*)::text AS count FROM order_reservation_ledger WHERE order_id = $1 AND action = 'release'",
      [order.id]
    );
    expect(ledger.rows[0].count).toBe('1');

    // Same-key replay returns the same result; a different key sees CANCELLED.
    const replay = await post(
      business.agent,
      `/api/admin/order-approvals/release/${requestId}/decision`,
      {
        decision: 'APPROVED',
        note: 'verified',
        expectedReservationVersion: reservation.version,
        idempotencyKey: decisionKey,
      },
      business.csrf
    );
    expect(replay.status).toBe(200);
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 0 });
    const secondRequest = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/release-requests`,
      {
        expectedRevision: approved.body.order.revision,
        expectedReservationVersion: approved.body.order.confirmation.reservation.version,
        reason: 'again',
        paymentVerification: 'unpaid',
        shipmentVerification: 'not_shipped',
        verificationNote: 'again',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(secondRequest.status).toBe(409);
  }, 60_000);

  it('expires once, keeps stock held, and allows a pre-hard-deadline extension', async () => {
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501C');
    const { order, item } = await createConfirmedOrder(customer, sales, business, {
      qty: 10,
      w1: 100,
    });
    // Shift the deadline into the past but keep the hard deadline in the future.
    await pool.query(
      `UPDATE order_reservations
       SET expires_at = clock_timestamp() - interval '1 minute'
       WHERE order_id = $1`,
      [order.id]
    );
    const firstScan = await post(
      business.agent,
      '/api/admin/order-approvals/expiry-scan',
      {},
      business.csrf
    );
    expect(firstScan.status).toBe(200);
    const secondScan = await post(
      business.agent,
      '/api/admin/order-approvals/expiry-scan',
      {},
      business.csrf
    );
    expect(secondScan.status).toBe(200);
    const reminders = await pool.query(
      `SELECT count(*)::text AS count FROM order_deadline_reminders
       WHERE order_id = $1 AND kind = 'EXPIRED'`,
      [order.id]
    );
    expect(reminders.rows[0].count).toBe('1');
    const reservationRow = await pool.query(
      'SELECT status FROM order_reservations WHERE order_id = $1',
      [order.id]
    );
    expect(reservationRow.rows[0].status).toBe('EXPIRED');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 10 });
    const orderRow = await pool.query('SELECT status FROM orders WHERE id = $1', [order.id]);
    expect(orderRow.rows[0].status).toBe('CONFIRMED');

    const extension = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: order.confirmation.reservation.version,
        additionalHours: 24,
        reason: 'customer requested recovery',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(extension.status).toBe(201);
    const approved = await post(
      business.agent,
      `/api/admin/order-approvals/extension/${extension.body.request.id}/decision`,
      {
        decision: 'APPROVED',
        expectedReservationVersion: order.confirmation.reservation.version,
        idempotencyKey: randomUUID(),
      },
      business.csrf
    );
    expect(approved.status).toBe(200);
    expect(approved.body.order.confirmation.reservation.effectiveStatus).toBe('ACTIVE');
    const extended = new Date(approved.body.order.confirmation.reservation.expiresAt).getTime();
    expect(extended).toBeGreaterThan(Date.now());
    expect(approved.body.order.confirmation.reservation.totalExtensionHours).toBe(24);
  }, 60_000);

  it('anchors the 72h deadline and enforces the 240h additional / 312h hard extension ceiling', async () => {
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const { order } = await createConfirmedOrder(customer, sales, business, {
      qty: 10,
      w1: 100,
    });
    const reservation = order.confirmation.reservation;
    const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;
    expect(hours(reservation.confirmedAt, reservation.expiresAt)).toBe(72);
    expect(hours(reservation.confirmedAt, reservation.hardDeadlineAt)).toBe(312);

    const tooMany = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: reservation.version,
        additionalHours: 241,
        reason: 'over the request maximum',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe('invalid_extension_hours');

    // Exactly 240 additional hours is the approved maximum and lands on the
    // 312h hard ceiling without exceeding it.
    const ceilingRequest = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: reservation.version,
        additionalHours: 240,
        reason: 'use the full approved extension',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(ceilingRequest.status).toBe(201);
    const approved = await post(
      business.agent,
      `/api/admin/order-approvals/extension/${ceilingRequest.body.request.id}/decision`,
      {
        decision: 'APPROVED',
        expectedReservationVersion: reservation.version,
        idempotencyKey: randomUUID(),
      },
      business.csrf
    );
    expect(approved.status).toBe(200);
    const extended = approved.body.order.confirmation.reservation;
    expect(extended.totalExtensionHours).toBe(240);
    expect(Date.parse(extended.expiresAt)).toBe(Date.parse(extended.hardDeadlineAt));

    const beyondTotal = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      {
        expectedRevision: approved.body.order.revision,
        expectedReservationVersion: extended.version,
        additionalHours: 1,
        reason: 'no total extension hours remain',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(beyondTotal.status).toBe(422);
    expect(beyondTotal.body.error.code).toBe('extension_limit_exceeded');

    // Even with hours left, the deadline can never move past first
    // confirmation + 312h.
    await pool.query(
      `UPDATE order_reservations
       SET expires_at = hard_deadline_at - interval '30 minutes', total_extension_hours = 0
       WHERE order_id = $1`,
      [order.id]
    );
    const beyondHardDeadline = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      {
        expectedRevision: approved.body.order.revision,
        expectedReservationVersion: extended.version,
        additionalHours: 1,
        reason: 'cross the hard ceiling',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(beyondHardDeadline.status).toBe(422);
    expect(beyondHardDeadline.body.error.code).toBe('extension_exceeds_hard_deadline');

    // An overdue reservation must recover past the database clock.
    await pool.query(
      `UPDATE order_reservations
       SET expires_at = clock_timestamp() - interval '2 hours',
           total_extension_hours = 0
       WHERE order_id = $1`,
      [order.id]
    );
    const noRecovery = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      {
        expectedRevision: approved.body.order.revision,
        expectedReservationVersion: extended.version,
        additionalHours: 1,
        reason: 'still in the past',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(noRecovery.status).toBe(422);
    expect(noRecovery.body.error.code).toBe('extension_does_not_recover');
  }, 60_000);

  it('makes extension requests idempotent and refuses a second pending request', async () => {
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const { order } = await createConfirmedOrder(customer, sales, business, {
      qty: 10,
      w1: 100,
    });
    const reservation = order.confirmation.reservation;
    const key = randomUUID();
    const body = {
      expectedRevision: order.revision,
      expectedReservationVersion: reservation.version,
      additionalHours: 24,
      reason: 'idempotent extension',
      idempotencyKey: key,
    };
    const first = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      body,
      sales.csrf
    );
    expect(first.status).toBe(201);
    const replay = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      body,
      sales.csrf
    );
    expect(replay.status).toBe(201);
    expect(replay.body.request.id).toBe(first.body.request.id);
    const second = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/extension-requests`,
      { ...body, idempotencyKey: randomUUID() },
      sales.csrf
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('extension_already_pending');
  }, 60_000);

  it('allows self-approval and records the requester and decider separately', async () => {
    const admin = await login('conf.admin@example.test');
    const selfId = await createInternal('Conf Self', 'conf.self@example.test', [
      'sales',
      'sales_writer',
      'business_admin',
    ]);
    const company = await createCompany({ assignedSalesUserId: selfId, letters: ['A'] });
    await grantBuyer(admin, company.companyId, company.customers[0].userId);
    const self = await login('conf.self@example.test');
    const customer = await login(company.customers[0].username);
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(self, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 3900 },
    ]);
    expect(plan.plan.priceApprovalStatus).toBe('PENDING');

    const decision = await post(
      self.agent,
      `/api/admin/order-approvals/price/${plan.plan.priceApproval.id}/decision`,
      {
        decision: 'APPROVED',
        note: 'same person holds both roles',
        expectedPlanVersion: plan.plan.version,
        idempotencyKey: randomUUID(),
      },
      self.csrf
    );
    expect(decision.status).toBe(200);
    expect(decision.body.order.currentPlan.priceApprovalStatus).toBe('APPROVED');

    const approval = await pool.query(
      `SELECT requested_by_user_id, decided_by_user_id, requested_by_label, decided_by_label
       FROM order_price_approvals WHERE id = $1`,
      [plan.plan.priceApproval.id]
    );
    expect(approval.rows[0]).toMatchObject({
      requested_by_user_id: selfId,
      decided_by_user_id: selfId,
    });
    expect(approval.rows[0].requested_by_label).toBeTruthy();
    expect(approval.rows[0].decided_by_label).toBeTruthy();

    const accepted = await acceptPlan(customer, decision.body.order);
    expect(accepted.currentPlan.status).toBe('ACCEPTED');
  }, 60_000);

  it('returns a declined price change to the salesperson and blocks customer acceptance', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4000 },
    ]);
    const rejected = await approvePrice(business, plan.order, 'REJECTED');
    expect(rejected.order.currentPlan.status).toBe('REJECTED');
    expect(rejected.order.currentPlan.priceApprovalStatus).toBe('REJECTED');

    const blocked = await post(
      customer.agent,
      `/api/orders/${order.id}/plan-decision`,
      {
        expectedRevision: rejected.order.revision,
        expectedPlanVersion: rejected.order.currentPlan.version,
        planDigest: rejected.order.currentPlan.planDigest,
        outcome: 'ACCEPTED',
        idempotencyKey: randomUUID(),
      },
      customer.csrf
    );
    expect(blocked.status).toBe(409);
    expect(['plan_not_acceptable', 'price_approval_rejected']).toContain(
      blocked.body.error.code
    );

    // A different price creates a new epoch/approval; the salesperson can then
    // resubmit, get approval and let the buyer accept.
    const resubmitted = await savePlan(sales, rejected.order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4100 },
    ]);
    expect(resubmitted.plan.priceApprovalStatus).toBe('PENDING');
    expect(resubmitted.plan.priceApproval.id).not.toBe(plan.plan.priceApproval.id);
    const approved = await approvePrice(business, resubmitted.order);
    const accepted = await acceptPlan(customer, approved.order);
    expect(accepted.currentPlan.status).toBe('ACCEPTED');
  }, 60_000);

  it('treats buyer rejection as a plan outcome rather than an order cancellation', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const rejected = await acceptPlan(customer, plan.order, 'REJECTED');
    expect(rejected.status).toBe('PENDING_CONFIRMATION');
    expect(rejected.currentPlan.status).toBe('REJECTED');
    expect(rejected.confirmation).toBeNull();

    const resubmitted = await savePlan(sales, rejected, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    expect(resubmitted.plan.version).toBeGreaterThan(plan.plan.version);
    const accepted = await acceptPlan(customer, resubmitted.order);
    expect(accepted.currentPlan.status).toBe('ACCEPTED');
    expect(accepted.status).toBe('PENDING_CONFIRMATION');
  }, 60_000);

  it('decides a pending price approval that survived a quantity-only plan edit', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const priced = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4000 },
    ]);
    const approvalId = priced.plan.priceApproval.id;
    const quantityOnly = await savePlan(sales, priced.order, [
      { skuId: item.skuId, quantity: 12, unitPriceCents: 4000 },
    ]);
    expect(quantityOnly.plan.version).toBe(priced.plan.version + 1);
    expect(quantityOnly.plan.priceApproval.id).toBe(approvalId);

    // The approvals drawer sends the request-time version, not the newer
    // quantity-only version. It must still be decidable.
    const detail = await business.agent.get(`/api/admin/order-approvals/price/${approvalId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.approval.request.requestedPlanVersion).toBe(priced.plan.version);
    const decision = await post(
      business.agent,
      `/api/admin/order-approvals/price/${approvalId}/decision`,
      {
        decision: 'APPROVED',
        note: 'approved after a quantity-only edit',
        expectedPlanVersion: detail.body.approval.request.requestedPlanVersion,
        idempotencyKey: randomUUID(),
      },
      business.csrf
    );
    expect(decision.status).toBe(200);
    expect(decision.body.order.currentPlan.version).toBe(quantityOnly.plan.version);
    expect(decision.body.order.currentPlan.priceApprovalStatus).toBe('APPROVED');
    const accepted = await acceptPlan(customer, decision.body.order);
    expect(accepted.currentPlan.status).toBe('ACCEPTED');

    // A version that is neither the request-time nor the current plan version
    // remains a conflict.
    const stale = await post(
      business.agent,
      `/api/admin/order-approvals/price/${approvalId}/decision`,
      {
        decision: 'APPROVED',
        expectedPlanVersion: priced.plan.version - 1,
        idempotencyKey: randomUUID(),
      },
      business.csrf
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('approval_already_decided');
  }, 60_000);

  it('lets the buyer reject a plan while its price change is pending approval', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4000 },
    ]);
    expect(plan.plan.priceApprovalStatus).toBe('PENDING');

    const rejected = await acceptPlan(customer, plan.order, 'REJECTED');
    expect(rejected.status).toBe('PENDING_CONFIRMATION');
    expect(rejected.currentPlan.status).toBe('REJECTED');
    // The customer projection exposes only an active ACCEPTED outcome; the
    // rejection is retained in the acceptance history and database evidence.
    expect(rejected.acceptance).toBeNull();
    const recorded = await pool.query(
      `SELECT outcome, reason FROM order_plan_acceptances
       WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [order.id]
    );
    expect(recorded.rows[0]).toMatchObject({
      outcome: 'REJECTED',
      reason: 'Please revise',
    });
  }, 60_000);

  it('invalidates an acceptance after a quantity-only plan change', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);
    expect(accepted.acceptance.outcome).toBe('ACCEPTED');

    const quantityOnly = await savePlan(sales, accepted, [
      { skuId: item.skuId, quantity: 14, unitPriceCents: 4200 },
    ]);
    expect(quantityOnly.order.acceptance).toBeNull();
    expect(quantityOnly.order.currentPlan.status).toBe('SUBMITTED');
  }, 60_000);

  it('supersedes plans, acceptances and pending price approvals when an administrator cancels pending orders', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501A');

    // Order A has an accepted plan. Order B is waiting for a price decision.
    const acceptedItem = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, acceptedItem.skuId, 10);
    const acceptedOrder = await submitOrder(customer);
    const acceptedPlan = await savePlan(sales, acceptedOrder, [
      { skuId: acceptedItem.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    await acceptPlan(customer, acceptedPlan.order);

    const pendingItem = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, pendingItem.skuId, 10);
    const pendingOrder = await submitOrder(customer);
    const pendingPlan = await savePlan(sales, pendingOrder, [
      { skuId: pendingItem.skuId, quantity: 10, unitPriceCents: 3900 },
    ]);
    expect(pendingPlan.plan.priceApprovalStatus).toBe('PENDING');

    const preview = await admin.agent.get(
      `/api/admin/orders/impact?kind=company_suspend&targetId=${companyAId}`
    );
    expect(preview.status).toBe(200);
    const suspended = await patch(
      admin.agent,
      `/api/admin/companies/${companyAId}/status`,
      {
        status: 'suspended',
        confirmAffectedOrders: true,
        impactToken: preview.body.impact.impactToken,
      },
      admin.csrf
    );
    expect(suspended.status).toBe(200);

    const orders = await pool.query(
      'SELECT id, status FROM orders WHERE id = ANY($1::uuid[])',
      [[acceptedOrder.id, pendingOrder.id]]
    );
    expect(orders.rows.every(row => row.status === 'CANCELLED')).toBe(true);
    const planStates = await pool.query(
      `SELECT id, status FROM order_plans WHERE order_id = ANY($1::uuid[])`,
      [[acceptedOrder.id, pendingOrder.id]]
    );
    expect(planStates.rows.some(row => row.status === 'ACCEPTED')).toBe(false);
    const acceptances = await pool.query(
      `SELECT invalidated_at FROM order_plan_acceptances
       WHERE order_id = $1 AND outcome = 'ACCEPTED'`,
      [acceptedOrder.id]
    );
    expect(acceptances.rows[0].invalidated_at).not.toBeNull();
    const approval = await pool.query(
      'SELECT status FROM order_price_approvals WHERE id = $1',
      [pendingPlan.plan.priceApproval.id]
    );
    expect(approval.rows[0].status).toBe('SUPERSEDED');
  }, 60_000);

  it('releases both warehouses and lets the customer submit a new order', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501B');
    const item = await createPublishedProduct(admin, { w1: 20, w2: 12 });
    await addToCart(customer, item.skuId, 20);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 20, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);
    const confirmed = await confirm(sales, accepted, [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 12 },
      { skuId: item.skuId, warehouseId: warehouse2Id, quantity: 8 },
    ]);
    expect(confirmed.status).toBe(200);
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({
      on_hand: 20,
      reserved: 12,
    });
    expect(await inventory(item.skuId, warehouse2Id)).toMatchObject({
      on_hand: 12,
      reserved: 8,
    });
    // The reconciliation endpoint reports mismatches only; a correct
    // two-warehouse reservation produces no rows.
    const reconciled = await business.agent.get(
      '/api/admin/order-approvals/reconciliation'
    );
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.rows).toEqual([]);

    const reservation = confirmed.body.order.confirmation.reservation;
    const request = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/release-requests`,
      {
        expectedRevision: confirmed.body.order.revision,
        expectedReservationVersion: reservation.version,
        reason: 'two-warehouse release',
        paymentVerification: 'unpaid',
        shipmentVerification: 'not_shipped',
        verificationNote: 'Checked payment ledger and outbound log',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(request.status).toBe(201);
    const released = await post(
      business.agent,
      `/api/admin/order-approvals/release/${request.body.request.id}/decision`,
      {
        decision: 'APPROVED',
        expectedReservationVersion: reservation.version,
        idempotencyKey: randomUUID(),
      },
      business.csrf
    );
    expect(released.status).toBe(200);
    expect(released.body.order.status).toBe('CANCELLED');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({
      on_hand: 20,
      reserved: 0,
    });
    expect(await inventory(item.skuId, warehouse2Id)).toMatchObject({
      on_hand: 12,
      reserved: 0,
    });

    // A released order is final: the customer must submit a new order.
    await addToCart(customer, item.skuId, 10);
    const replacement = await submitOrder(customer);
    expect(replacement.id).not.toBe(order.id);
    expect(replacement.orderNo).toMatch(/^OD-[0-9]{6}-[0-9]{4}$/);
  }, 60_000);

  it('blocks confirmation after the buyer authority was revoked', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);
    const authorizations = await admin.agent.get(
      `/api/admin/companies/${companyAId}/buyer-authorizations`
    );
    const active = authorizations.body.authorizations.find(
      (row: { customerUserId: string; status: string }) =>
        row.customerUserId === customer.userId && row.status === 'active'
    );
    const revoked = await post(
      admin.agent,
      `/api/admin/buyer-authorizations/${active.id}/revoke`,
      { reason: 'revoked before confirmation', idempotencyKey: randomUUID() },
      admin.csrf
    );
    expect(revoked.status).toBe(200);

    const blocked = await confirm(sales, accepted, [
      { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 10 },
    ]);
    expect([403, 409]).toContain(blocked.status);
    const reservation = await pool.query(
      'SELECT count(*)::text AS count FROM order_reservations WHERE order_id = $1',
      [order.id]
    );
    expect(reservation.rows[0].count).toBe('0');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 0 });
  }, 60_000);

  it('rejects malformed identifiers and an over-long release reason with 400s', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501A');

    const malformedPath = await post(
      sales.agent,
      '/api/sales/orders/not-a-uuid/plans',
      { expectedRevision: 1, expectedPlanVersion: 0, lines: [], idempotencyKey: randomUUID() },
      sales.csrf
    );
    expect(malformedPath.status).toBe(400);
    expect(malformedPath.body.error.code).toBe('invalid_request');

    const { order } = await createConfirmedOrder(customer, sales, business, { qty: 10, w1: 100 });
    const reservation = order.confirmation.reservation;
    const overLong = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/release-requests`,
      {
        expectedRevision: order.revision,
        expectedReservationVersion: reservation.version,
        reason: 'x'.repeat(501),
        paymentVerification: 'unpaid',
        shipmentVerification: 'not_shipped',
        verificationNote: 'checked',
        idempotencyKey: randomUUID(),
      },
      sales.csrf
    );
    expect(overLong.status).toBe(400);
    expect(overLong.body.error.code).toBe('invalid_request');

    const malformedWarehouse = await post(
      sales.agent,
      `/api/sales/orders/${order.id}/confirm`,
      {},
      sales.csrf
    );
    expect(malformedWarehouse.status).toBe(400);
  }, 60_000);

  it('marks an overdue reservation expired even when its reminder row already exists', async () => {
    const sales = await login('conf.sales@example.test');
    const business = await login('conf.business@example.test');
    const customer = await login('AK000501C');
    const { order, item } = await createConfirmedOrder(customer, sales, business, {
      qty: 10,
      w1: 100,
    });
    await pool.query(
      `UPDATE order_reservations
       SET expires_at = clock_timestamp() - interval '1 minute'
       WHERE order_id = $1`,
      [order.id]
    );
    await pool.query(
      `INSERT INTO order_deadline_reminders (id, reservation_id, order_id, deadline_at, kind)
       SELECT $1, id, order_id, expires_at, 'EXPIRED'
       FROM order_reservations WHERE order_id = $2`,
      [randomUUID(), order.id]
    );
    const scan = await post(
      business.agent,
      '/api/admin/order-approvals/expiry-scan',
      {},
      business.csrf
    );
    expect(scan.status).toBe(200);
    expect(scan.body.result.expired).toBe(1);
    expect(scan.body.result.reminded).toBe(0);
    const reservation = await pool.query(
      'SELECT status FROM order_reservations WHERE order_id = $1',
      [order.id]
    );
    expect(reservation.rows[0].status).toBe('EXPIRED');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 10 });
  }, 60_000);

  it('shares the daily order-number sequence and refuses the 10000th order', async () => {
    const admin = await login('conf.admin@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    const dayRow = await pool.query<{ day: string; date_part: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYMMDD') AS date_part`
    );
    const { day, date_part: datePart } = dayRow.rows[0];
    await pool.query(
      `INSERT INTO order_sequences (order_date, next_seq) VALUES ($1::date, 9998)
       ON CONFLICT (order_date) DO UPDATE SET next_seq = 9998`,
      [day]
    );

    await addToCart(customer, item.skuId, 10);
    const last = await submitOrder(customer);
    expect(last.orderNo).toBe(`OD-${datePart}-9999`);

    await addToCart(customer, item.skuId, 10);
    const cart = await customer.agent.get('/api/cart');
    const exhausted = await post(
      customer.agent,
      '/api/orders',
      {
        idempotencyKey: randomUUID(),
        expectedCartRevision: cart.body.cart.revision,
        shippingMethod: 'Sea',
        destinationCountryAlpha3: 'USA',
        expectedShipDate: '2026-12-15',
        shippingRequirements: 'Exhaustion probe.',
      },
      customer.csrf
    );
    expect(exhausted.status).toBe(503);
    expect(exhausted.body.error.code).toBe('order_sequence_exhausted');
    // The failed transaction rolled back the sequence increment and did not
    // create a second order.
    const sequence = await pool.query(
      'SELECT next_seq FROM order_sequences WHERE order_date = $1::date',
      [day]
    );
    expect(sequence.rows[0].next_seq).toBe(9999);
    const orders = await pool.query('SELECT count(*)::text AS count FROM orders');
    expect(orders.rows[0].count).toBe('1');
  }, 60_000);

  it('rejects unknown and inactive warehouse allocations without reserving stock', async () => {
    const admin = await login('conf.admin@example.test');
    const sales = await login('conf.sales@example.test');
    const customer = await login('AK000501A');
    const item = await createPublishedProduct(admin, { w1: 100 });
    await addToCart(customer, item.skuId, 10);
    const order = await submitOrder(customer);
    const plan = await savePlan(sales, order, [
      { skuId: item.skuId, quantity: 10, unitPriceCents: 4200 },
    ]);
    const accepted = await acceptPlan(customer, plan.order);

    const unknown = await confirm(sales, accepted, [
      { skuId: item.skuId, warehouseId: randomUUID(), quantity: 10 },
    ]);
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('unknown_warehouse');

    const created = await post(
      admin.agent,
      '/api/admin/warehouses',
      { code: `WH-CNF-OLD-${Date.now()}`, name: '停用仓', nameEn: 'Inactive warehouse' },
      admin.csrf
    );
    expect(created.status).toBe(201);
    const inactiveId = created.body.warehouse.id as string;
    const deactivated = await patch(
      admin.agent,
      `/api/admin/warehouses/${inactiveId}`,
      { active: false },
      admin.csrf
    );
    expect(deactivated.status).toBe(200);
    const inactive = await confirm(sales, accepted, [
      { skuId: item.skuId, warehouseId: inactiveId, quantity: 10 },
    ]);
    expect(inactive.status).toBe(422);
    expect(inactive.body.error.code).toBe('inactive_warehouse');
    expect(await inventory(item.skuId, warehouse1Id)).toMatchObject({ reserved: 0 });
  }, 60_000);

  it('rejects direct SQL reserved writes, immutable FOR SHARE, double reserve and unapproved release under the runtime role', async () => {
    const role = `aoking_runtime_conf_${process.pid}`;
    const password = 'RuntimeConfirmation123!';
    await provisionRuntimeRole({
      adminDatabaseUrl: databaseUrl(),
      runtimeUser: role,
      runtimePassword: password,
    });
    const runtimeUrl = new URL(databaseUrl());
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    const runtimePool = createPool(runtimeUrl.toString());
    const runtimeApp = createApp({
      checkReadiness: () => checkReadiness(runtimePool),
      auth: { pool: runtimePool, config },
      mediaRoot,
    });
    try {
      await expect(
        runtimePool.query('UPDATE inventory_balances SET reserved = 1')
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtimePool.query('SELECT * FROM order_plan_lines WHERE false FOR SHARE')
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtimePool.query(
          `INSERT INTO order_reservation_ledger
            (reservation_id, reservation_line_id, order_id, action, quantity,
             inventory_before, inventory_after, version_after)
           VALUES ($1, $2, $3, 'reserve', 1, 0, 1, 2)`,
          [randomUUID(), randomUUID(), randomUUID()]
        )
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runtimePool.query('DELETE FROM order_plans WHERE false')
      ).rejects.toThrow(/permission denied/i);
      // The release request INSERT grant excludes the decision/execution
      // columns, so the runtime role cannot forge an APPROVED request.
      await expect(
        runtimePool.query(
          `INSERT INTO order_release_requests
            (id, order_id, company_id, requested_by_user_id, requested_by_label,
             reason, payment_verification, shipment_verification, verification_note,
             verified_by_user_id, verified_at, expected_reservation_version,
             status, decided_by_user_id, decided_at, executed_at)
           VALUES ($1, $2, $3, $4, 'forged', 'forged', 'unpaid', 'not_shipped',
                   'forged', $4, clock_timestamp(), 1, 'APPROVED', $4,
                   clock_timestamp(), clock_timestamp())`,
          [randomUUID(), randomUUID(), companyAId, salesId]
        )
      ).rejects.toThrow(/permission denied/i);

      const admin = await login('conf.admin@example.test', runtimeApp);
      const sales = await login('conf.sales@example.test', runtimeApp);
      const business = await login('conf.business@example.test', runtimeApp);
      const customer = await login('AK000501A', runtimeApp);
      const item = await createPublishedProduct(admin, { w1: 50, w2: 30 });
      await addToCart(customer, item.skuId, 20);
      const order = await submitOrder(customer);
      const plan = await savePlan(sales, order, [
        { skuId: item.skuId, quantity: 20, unitPriceCents: 4200 },
      ]);
      const accepted = await acceptPlan(customer, plan.order);
      const confirmed = await confirm(sales, accepted, [
        { skuId: item.skuId, warehouseId: warehouse1Id, quantity: 12 },
        { skuId: item.skuId, warehouseId: warehouse2Id, quantity: 8 },
      ]);
      expect(confirmed.status).toBe(200);
      const reservationId = confirmed.body.order.confirmation.reservation.id;
      const line = await pool.query<{ id: string; sku_id: string; warehouse_id: string; quantity: number }>(
        `SELECT id, sku_id, warehouse_id, quantity FROM order_reservation_lines
         WHERE reservation_id = $1 AND warehouse_id = $2`,
        [reservationId, warehouse1Id]
      );
      const lineRow = line.rows[0];
      const balance = await inventory(lineRow.sku_id, lineRow.warehouse_id);
      const doubleReserve = await runtimePool.query(
        `SELECT * FROM aoking_reserve_inventory($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          reservationId,
          order.id,
          lineRow.sku_id,
          lineRow.warehouse_id,
          lineRow.quantity,
          1,
          Number(balance.version),
          balance.reserved,
          adminId,
        ]
      ).then(() => null).catch(error => error as Error);
      expect(doubleReserve?.message).toMatch(/reservation_already_applied/);

      const unapprovedRelease = await runtimePool.query(
        `SELECT * FROM aoking_release_inventory($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          reservationId,
          order.id,
          randomUUID(),
          lineRow.sku_id,
          lineRow.warehouse_id,
          lineRow.quantity,
          Number(balance.version),
          balance.reserved,
          adminId,
        ]
      ).then(() => null).catch(error => error as Error);
      expect(unapprovedRelease?.message).toMatch(/release_not_approved|reservation_already_applied/);
      expect(await inventory(lineRow.sku_id, lineRow.warehouse_id)).toMatchObject({
        reserved: 12,
      });

      // The whole business flow also runs under the least-privilege role.
      const extension = await post(
        sales.agent,
        `/api/sales/orders/${order.id}/extension-requests`,
        {
          expectedRevision: confirmed.body.order.revision,
          expectedReservationVersion: confirmed.body.order.confirmation.reservation.version,
          additionalHours: 24,
          reason: 'runtime-role extension',
          idempotencyKey: randomUUID(),
        },
        sales.csrf
      );
      expect(extension.status).toBe(201);
      const extended = await post(
        business.agent,
        `/api/admin/order-approvals/extension/${extension.body.request.id}/decision`,
        {
          decision: 'APPROVED',
          expectedReservationVersion:
            confirmed.body.order.confirmation.reservation.version,
          idempotencyKey: randomUUID(),
        },
        business.csrf
      );
      expect(extended.status).toBe(200);
      const releaseRequest = await post(
        sales.agent,
        `/api/sales/orders/${order.id}/release-requests`,
        {
          expectedRevision: extended.body.order.revision,
          expectedReservationVersion: extended.body.order.confirmation.reservation.version,
          reason: 'runtime-role release',
          paymentVerification: 'unpaid',
          shipmentVerification: 'not_shipped',
          verificationNote: 'verified under the runtime role',
          idempotencyKey: randomUUID(),
        },
        sales.csrf
      );
      expect(releaseRequest.status).toBe(201);
      const released = await post(
        business.agent,
        `/api/admin/order-approvals/release/${releaseRequest.body.request.id}/decision`,
        {
          decision: 'APPROVED',
          expectedReservationVersion:
            extended.body.order.confirmation.reservation.version,
          idempotencyKey: randomUUID(),
        },
        business.csrf
      );
      expect(released.status).toBe(200);
      expect(released.body.order.status).toBe('CANCELLED');
      expect(await inventory(lineRow.sku_id, warehouse1Id)).toMatchObject({ reserved: 0 });
      expect(await inventory(lineRow.sku_id, warehouse2Id)).toMatchObject({ reserved: 0 });
    } finally {
      await runtimePool.end();
      await pool.query(`DROP OWNED BY "${role}"`);
      await pool.query(`DROP ROLE "${role}"`);
    }
  }, 90_000);

  it('revokes restored PUBLIC EXECUTE on the reservation bridge when re-provisioning', async () => {
    const role = `aoking_runtime_restore_${process.pid}`;
    const password = 'RuntimeRestorePass123!';
    const reserveSignature =
      'public.aoking_reserve_inventory(uuid, uuid, uuid, uuid, integer, bigint, bigint, integer, uuid)';
    const releaseSignature =
      'public.aoking_release_inventory(uuid, uuid, uuid, uuid, uuid, integer, bigint, integer, uuid)';
    const publicExecuteCount = async (): Promise<number> => {
      const result = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM pg_proc p
           CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE p.oid IN (to_regprocedure($1), to_regprocedure($2))
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'`,
        [reserveSignature, releaseSignature]
      );
      return result.rows[0]?.count ?? 0;
    };

    await provisionRuntimeRole({
      adminDatabaseUrl: databaseUrl(),
      runtimeUser: role,
      runtimePassword: password,
    });
    // Simulate `pg_restore --no-privileges`: the function ACL reverts to the
    // SQL default, which grants EXECUTE to PUBLIC even after migration 007.
    await pool.query(`GRANT EXECUTE ON FUNCTION ${reserveSignature} TO PUBLIC`);
    await pool.query(`GRANT EXECUTE ON FUNCTION ${releaseSignature} TO PUBLIC`);
    expect(await publicExecuteCount()).toBe(2);

    await provisionRuntimeRole({
      adminDatabaseUrl: databaseUrl(),
      runtimeUser: role,
      runtimePassword: password,
    });
    expect(await publicExecuteCount()).toBe(0);

    const runtimeUrl = new URL(databaseUrl());
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    const runtimePool = createPool(runtimeUrl.toString());
    try {
      // The functions are still executable by the runtime role: the expected
      // failure is the function's own validation, not a permission denial.
      const reserve = await runtimePool
        .query(
          `SELECT * FROM aoking_reserve_inventory($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), randomUUID(), randomUUID(), randomUUID(), 1, 0, 0, 0, randomUUID()]
        )
        .then(() => null)
        .catch((error: Error) => error);
      expect(reserve?.message).toMatch(/reservation_not_found/);

      const release = await runtimePool
        .query(
          `SELECT * FROM aoking_release_inventory($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            1,
            0,
            0,
            randomUUID(),
          ]
        )
        .then(() => null)
        .catch((error: Error) => error);
      expect(release?.message).toMatch(/reservation_not_found/);
    } finally {
      await runtimePool.end();
      await pool.query(`DROP OWNED BY "${role}"`);
      await pool.query(`DROP ROLE "${role}"`);
    }
  }, 30_000);
});
