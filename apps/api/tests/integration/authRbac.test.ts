import { randomUUID } from 'node:crypto';
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
const TEMP_PASSWORD = 'TempPass123!Strong';
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

let adminId = '';
let adminWriterId = '';
let sales1Id = '';
let sales2Id = '';
let companyAId = '';
let companyBId = '';
let companyCId = '';
let companyDId = '';
let companyEId = '';
let companyFId = '';
let customerAId = '';
let customerBId = '';
let firstLoginUserId = '';
let suspendedUserId = '';
let suspendedCompanyUserId = '';
let userSuspensionUserId = '';

async function resetSchema(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}

async function createInternal(
  name: string,
  email: string,
  roles: string[]
): Promise<string> {
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
  mustChange?: boolean;
  userStatus?: 'active' | 'suspended';
  companyStatus?: 'active' | 'suspended';
  password?: string;
}): Promise<{ companyId: string; userId: string }> {
  const companyId = randomUUID();
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO customer_companies
      (id, customer_code, short_name, country_alpha3, assigned_sales_user_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'USA', $4, $5, now(), now())`,
    [companyId, options.code, options.name, options.assignedSalesUserId, options.companyStatus ?? 'active']
  );
  await pool.query(
    `INSERT INTO customer_users
      (id, company_id, username, account_letter, password_hash, must_change_password, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'A', $4, $5, $6, now(), now())`,
    [
      userId,
      companyId,
      options.username,
      await hashPassword(options.password ?? PASSWORD),
      options.mustChange ?? false,
      options.userStatus ?? 'active',
    ]
  );
  await pool.query(
    `INSERT INTO brand_grants (company_id, brand_id, granted_at)
     VALUES ($1, 'brand-aoking', now())`,
    [companyId]
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
  username: string,
  password: string,
  token?: string
): Promise<{ response: SupertestResponse; csrfToken: string }> {
  const csrfToken = token ?? (await csrf(agent));
  const response = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', csrfToken)
    .send({ username, password });
  return { response, csrfToken };
}

async function loggedInAgent(username: string, password = PASSWORD): Promise<{
  agent: TestAgent;
  csrfToken: string;
  response: SupertestResponse;
}> {
  const agent = request.agent(app);
  const { response, csrfToken } = await login(agent, username, password);
  return { agent, csrfToken, response };
}

async function post(
  agent: TestAgent,
  path: string,
  body: Record<string, unknown>,
  csrfToken: string
) {
  return agent.post(path).set('X-CSRF-Token', csrfToken).send(body);
}

async function patch(
  agent: TestAgent,
  path: string,
  body: Record<string, unknown>,
  csrfToken: string
) {
  return agent.patch(path).set('X-CSRF-Token', csrfToken).send(body);
}

async function put(
  agent: TestAgent,
  path: string,
  body: Record<string, unknown>,
  csrfToken: string
) {
  return agent.put(path).set('X-CSRF-Token', csrfToken).send(body);
}

describeDb('authentication, RBAC and session isolation', () => {
  beforeAll(async () => {
    if (!safeDatabase) return;
    await resetSchema();
    await runMigrations(databaseUrl());
    pool = createPool(databaseUrl());
    app = createApp({
      checkReadiness: () => checkReadiness(pool),
      auth: { pool, config },
    });

    adminId = await createInternal('Admin One', 'admin.one@example.test', ['admin']);
    adminWriterId = await createInternal('Admin Writer', 'admin.writer@example.test', [
      'admin',
      'sales_writer',
    ]);
    sales1Id = await createInternal('Sales One', 'sales.one@example.test', ['sales']);
    sales2Id = await createInternal('Sales Two', 'sales.two@example.test', ['sales']);

    const a = await createCompanyWithCustomer({
      code: 'C000101',
      name: 'Company A',
      assignedSalesUserId: sales1Id,
      username: 'AK000101A',
    });
    companyAId = a.companyId;
    customerAId = a.userId;
    const b = await createCompanyWithCustomer({
      code: 'C000102',
      name: 'Company B',
      assignedSalesUserId: sales2Id,
      username: 'AK000102A',
    });
    companyBId = b.companyId;
    customerBId = b.userId;
    const c = await createCompanyWithCustomer({
      code: 'C000103',
      name: 'First Login Company',
      assignedSalesUserId: sales2Id,
      username: 'AK000103A',
      mustChange: true,
      password: TEMP_PASSWORD,
    });
    companyCId = c.companyId;
    firstLoginUserId = c.userId;
    const d = await createCompanyWithCustomer({
      code: 'C000104',
      name: 'Suspended Company',
      assignedSalesUserId: sales2Id,
      username: 'AK000104A',
      companyStatus: 'suspended',
    });
    companyDId = d.companyId;
    suspendedCompanyUserId = d.userId;
    const e = await createCompanyWithCustomer({
      code: 'C000105',
      name: 'Company E',
      assignedSalesUserId: sales2Id,
      username: 'AK000105A',
    });
    companyEId = e.companyId;
    const f = await createCompanyWithCustomer({
      code: 'C000106',
      name: 'User Suspension Company',
      assignedSalesUserId: sales2Id,
      username: 'AK000106A',
    });
    companyFId = f.companyId;
    userSuspensionUserId = f.userId;
    suspendedUserId = randomUUID();
    await pool.query(
      `INSERT INTO customer_users
        (id, company_id, username, account_letter, password_hash, must_change_password, status, created_at, updated_at)
       VALUES ($1, $2, 'AK000105B', 'B', $3, false, 'suspended', now(), now())`,
      [suspendedUserId, companyEId, await hashPassword(PASSWORD)]
    );

    await pool.query(
      `INSERT INTO brands (id, code, name, name_en, is_default_granted, active)
       VALUES ('brand-voyager', 'VOYAGER', 'VOYAGER Outdoor', 'VOYAGER Outdoor', false, true)
       ON CONFLICT (id) DO NOTHING`
    );
  }, 30_000);

  afterAll(async () => {
    if (!safeDatabase) return;
    await pool.end();
    await resetSchema();
  }, 30_000);

  it('logs in, returns a scoped session, and logs out', async () => {
    const { agent, csrfToken, response } = await loggedInAgent('AK000101A');
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      type: 'customer',
      username: 'AK000101A',
      companyId: companyAId,
    });
    expect(JSON.stringify(response.body)).not.toContain('password_hash');

    const companies = await agent.get('/api/companies');
    expect(companies.status).toBe(200);
    expect(companies.body.companies.map((company: { id: string }) => company.id)).toEqual([
      companyAId,
    ]);

    const session = await agent.get('/api/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.user.companyId).toBe(companyAId);

    const logout = await post(agent, '/api/auth/logout', {}, csrfToken);
    expect(logout.status).toBe(200);
    expect((await agent.get('/api/auth/session')).status).toBe(401);
  });

  it('requires CSRF for login and state-changing authenticated actions', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    expect(
      (await agent.post('/api/auth/login').send({ username: 'AK000101A', password: PASSWORD }))
        .status
    ).toBe(403);
    expect(
      (
        await agent
          .post('/api/auth/login')
          .set('X-CSRF-Token', 'wrong-token')
          .send({ username: 'AK000101A', password: PASSWORD })
      ).status
    ).toBe(403);

    const loggedIn = await login(agent, 'AK000101A', PASSWORD, token);
    expect(loggedIn.response.status).toBe(200);
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(403);
    expect((await post(agent, '/api/auth/logout', {}, token)).status).toBe(200);
  });

  it('isolates customer companies and rejects internal APIs', async () => {
    const a = await loggedInAgent('AK000101A');
    const b = await loggedInAgent('AK000102A');

    expect((await a.agent.get(`/api/companies/${companyAId}`)).status).toBe(200);
    expect((await a.agent.get(`/api/companies/${companyBId}`)).status).toBe(404);
    expect((await b.agent.get(`/api/companies/${companyBId}`)).status).toBe(200);
    expect((await b.agent.get(`/api/companies/${companyAId}`)).status).toBe(404);

    expect((await a.agent.get('/api/admin/companies')).status).toBe(403);
    expect((await a.agent.get('/api/sales/companies')).status).toBe(403);
    expect((await a.agent.get('/api/admin/audit-logs')).status).toBe(403);
  });

  it('scopes sales to assigned companies and lets admins read all', async () => {
    const sales1 = await loggedInAgent('sales.one@example.test');
    const sales2 = await loggedInAgent('sales.two@example.test');
    const admin = await loggedInAgent('admin.one@example.test');

    const sales1Companies = await sales1.agent.get('/api/sales/companies');
    expect(sales1Companies.status).toBe(200);
    expect(sales1Companies.body.companies.map((company: { id: string }) => company.id)).toEqual([
      companyAId,
    ]);
    expect((await sales1.agent.get(`/api/sales/companies/${companyBId}`)).status).toBe(403);

    const adminCompanies = await admin.agent.get('/api/companies');
    expect(adminCompanies.status).toBe(200);
    const ids = adminCompanies.body.companies.map((company: { id: string }) => company.id);
    expect(ids).toEqual(
      expect.arrayContaining([companyAId, companyBId, companyCId, companyDId, companyEId, companyFId])
    );

    const reassigned = await patch(
      admin.agent,
      `/api/admin/companies/${companyAId}/sales-assignment`,
      { salesUserId: sales2Id },
      admin.csrfToken
    );
    expect(reassigned.status).toBe(200);
    expect(
      (await sales1.agent.get('/api/sales/companies')).body.companies.map(
        (company: { id: string }) => company.id
      )
    ).not.toContain(companyAId);
    expect(
      (await sales2.agent.get('/api/sales/companies')).body.companies.map(
        (company: { id: string }) => company.id
      )
    ).toContain(companyAId);

    await patch(
      admin.agent,
      `/api/admin/companies/${companyAId}/sales-assignment`,
      { salesUserId: sales1Id },
      admin.csrfToken
    );
  });

  it('requires an extra sales.write grant for admin sales writes', async () => {
    const admin = await loggedInAgent('admin.one@example.test');
    const writer = await loggedInAgent('admin.writer@example.test');
    const sales = await loggedInAgent('sales.one@example.test');

    expect(
      (await post(admin.agent, `/api/sales/companies/${companyAId}/acknowledge`, {}, admin.csrfToken))
        .status
    ).toBe(403);
    expect(
      (await post(sales.agent, `/api/sales/companies/${companyAId}/acknowledge`, {}, sales.csrfToken))
        .status
    ).toBe(403);
    expect(
      (await post(writer.agent, `/api/sales/companies/${companyAId}/acknowledge`, {}, writer.csrfToken))
        .status
    ).toBe(200);

    const audit = await admin.agent.get('/api/admin/audit-logs');
    expect(audit.status).toBe(200);
    expect(audit.body.logs.some((log: { action: string }) => log.action === 'SALES_WRITE_ACKNOWLEDGED')).toBe(
      true
    );
    expect((await sales.agent.get('/api/admin/audit-logs')).status).toBe(403);
  });

  it('forces first-login password change before business access', async () => {
    const first = await loggedInAgent('AK000103A', TEMP_PASSWORD);
    expect(first.response.status).toBe(200);
    expect(first.response.body.user.mustChangePassword).toBe(true);
    expect((await first.agent.get('/api/companies')).status).toBe(403);
    expect((await first.agent.get('/api/auth/session')).status).toBe(200);

    const changed = await post(
      first.agent,
      '/api/auth/change-password',
      { currentPassword: TEMP_PASSWORD, newPassword: 'NewStrongPass123!' },
      first.csrfToken
    );
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await first.agent.get('/api/companies')).status).toBe(200);

    const stored = await pool.query<{ password_hash: string; must_change_password: boolean }>(
      'SELECT password_hash, must_change_password FROM customer_users WHERE id = $1',
      [firstLoginUserId]
    );
    expect(stored.rows[0]?.password_hash).not.toBe(TEMP_PASSWORD);
    expect(stored.rows[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(stored.rows[0]?.must_change_password).toBe(false);
  });

  it('rejects suspended users and companies and revokes active sessions', async () => {
    expect((await loggedInAgent('AK000105B')).response.status).toBe(401);
    expect((await loggedInAgent('AK000104A')).response.status).toBe(401);

    const customer = await loggedInAgent('AK000105A');
    expect(customer.response.status).toBe(200);
    const admin = await loggedInAgent('admin.one@example.test');
    expect(
      (await patch(
        admin.agent,
        `/api/admin/companies/${companyEId}/status`,
        { status: 'suspended' },
        admin.csrfToken
      )).status
    ).toBe(200);
    expect((await customer.agent.get('/api/companies')).status).toBe(401);

    expect(
      (await patch(
        admin.agent,
        `/api/admin/companies/${companyEId}/status`,
        { status: 'active' },
        admin.csrfToken
      )).status
    ).toBe(200);

    const userToSuspend = await loggedInAgent('AK000106A');
    expect(userToSuspend.response.status).toBe(200);
    expect(
      (await patch(
        admin.agent,
        `/api/admin/customers/${userSuspensionUserId}/status`,
        { status: 'suspended' },
        admin.csrfToken
      )).status
    ).toBe(200);
    expect((await userToSuspend.agent.get('/api/companies')).status).toBe(401);
    expect((await loggedInAgent('AK000106A')).response.status).toBe(401);
  });

  it('expires idle customer sessions and uses 2h internal idle sessions', async () => {
    const customer = await loggedInAgent('AK000101A');
    expect(customer.response.status).toBe(200);
    await pool.query(
      `UPDATE auth_sessions SET idle_expires_at = now() - interval '1 minute'
       WHERE customer_user_id = $1 AND revoked_at IS NULL`,
      [customerAId]
    );
    expect((await customer.agent.get('/api/auth/session')).status).toBe(401);

    const internal = await loggedInAgent('sales.one@example.test');
    expect(internal.response.status).toBe(200);
    const session = await pool.query<{ idle_expires_at: Date; absolute_expires_at: Date }>(
      `SELECT idle_expires_at, absolute_expires_at FROM auth_sessions
       WHERE internal_user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [sales1Id]
    );
    const idleHours =
      (new Date(session.rows[0].idle_expires_at).getTime() - Date.now()) / 3_600_000;
    expect(idleHours).toBeGreaterThan(1.9);
    expect(idleHours).toBeLessThan(2.1);
  });

  it('rate-limits repeated failed logins without revealing account validity', async () => {
    await pool.query('DELETE FROM login_attempts');
    const agent = request.agent(app);
    const token = await csrf(agent);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await login(agent, 'AK000102A', 'wrong-password', token);
      statuses.push(result.response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect((await login(agent, 'AK000102A', PASSWORD, token)).response.status).toBe(429);

    await pool.query('DELETE FROM login_attempts');
    expect((await login(agent, 'AK000102A', PASSWORD, token)).response.status).toBe(200);
  });

  it('creates companies, subaccounts and brand grants without storing plaintext passwords', async () => {
    const admin = await loggedInAgent('admin.one@example.test');
    const created = await post(
      admin.agent,
      '/api/admin/companies',
      {
        customerCode: 'C000777',
        shortName: 'Created Company',
        countryAlpha3: 'USA',
        assignedSalesUserId: sales1Id,
        brandIds: ['brand-aoking'],
      },
      admin.csrfToken
    );
    expect(created.status).toBe(201);
    const temporaryPassword = created.body.temporaryPassword as string;
    expect(created.body.primaryUsername).toBe('AK000777A');
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(JSON.stringify(created.body)).not.toContain('password_hash');

    const company = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM customer_companies WHERE customer_code = 'C000777'"
    );
    expect(company.rows[0]?.status).toBe('active');
    const stored = await pool.query<{ password_hash: string; must_change_password: boolean }>(
      `SELECT password_hash, must_change_password FROM customer_users
       WHERE company_id = $1 AND account_letter = 'A'`,
      [company.rows[0].id]
    );
    expect(stored.rows[0]?.password_hash).not.toBe(temporaryPassword);
    expect(stored.rows[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(stored.rows[0]?.must_change_password).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT 1 FROM brand_grants WHERE company_id = $1 AND brand_id = $2',
          [company.rows[0].id, 'brand-aoking']
        )
      ).rowCount
    ).toBe(1);

    expect(
      (
        await post(
          admin.agent,
          '/api/admin/companies',
          { customerCode: 'C000777', shortName: 'Duplicate', countryAlpha3: 'USA' },
          admin.csrfToken
        )
      ).status
    ).toBe(409);

    const secondary = await post(
      admin.agent,
      `/api/admin/companies/${company.rows[0].id}/accounts`,
      {},
      admin.csrfToken
    );
    expect(secondary.status).toBe(201);
    expect(secondary.body.username).toBe('AK000777B');
    expect(secondary.body.temporaryPassword).not.toBe(temporaryPassword);

    expect(
      (
        await put(
          admin.agent,
          `/api/admin/companies/${company.rows[0].id}/brands/brand-voyager`,
          { granted: true },
          admin.csrfToken
        )
      ).status
    ).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT 1 FROM brand_grants WHERE company_id = $1 AND brand_id = $2',
          [company.rows[0].id, 'brand-voyager']
        )
      ).rowCount
    ).toBe(1);

    const suspended = await patch(
      admin.agent,
      `/api/admin/companies/${company.rows[0].id}/status`,
      { status: 'suspended' },
      admin.csrfToken
    );
    expect(suspended.status).toBe(200);
    expect(suspended.body.company.status).toBe('suspended');
  });

  it('provisions a least-privilege runtime role separate from migrations', async () => {
    const role = `aoking_runtime_test_${process.pid}`;
    const password = 'RuntimePass123!Strong';
    await provisionRuntimeRole({
      adminDatabaseUrl: databaseUrl(),
      runtimeUser: role,
      runtimePassword: password,
    });

    const runtimeUrl = new URL(databaseUrl());
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    const runtimePool = createPool(runtimeUrl.toString());
    try {
      expect((await runtimePool.query('SELECT 1')).rowCount).toBe(1);
      await expect(runtimePool.query('CREATE TABLE should_not_exist (id integer)')).rejects.toThrow(
        /permission denied|must be owner/i
      );
      const runtimeApp = createApp({
        checkReadiness: () => checkReadiness(runtimePool),
        auth: { pool: runtimePool, config },
      });
      const runtimeAgent = request.agent(runtimeApp);
      const runtimeLogin = await login(runtimeAgent, 'AK000101A', PASSWORD);
      expect(runtimeLogin.response.status).toBe(200);
      expect((await runtimeAgent.get('/api/companies')).status).toBe(200);
    } finally {
      await runtimePool.end();
      const owner = new Client({ connectionString: databaseUrl() });
      await owner.connect();
      await owner.query(`DROP OWNED BY "${role}"`).catch(() => {});
      await owner.query(`DROP ROLE "${role}"`).catch(() => {});
      await owner.end();
    }
  }, 30_000);
});
