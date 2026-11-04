import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import { generateInitialPassword, hashPassword } from '../auth/password.js';
import type { AuthContext } from '../auth/types.js';

export interface CompanyRow {
  id: string;
  customer_code: string;
  short_name: string;
  country_alpha3: string;
  internal_nickname: string | null;
  assigned_sales_user_id: string | null;
  status: 'active' | 'suspended';
  created_at: Date;
  updated_at: Date;
}

/** Internal management DTO. Never return this shape to a customer session. */
export interface CompanyDto {
  id: string;
  customerCode: string;
  shortName: string;
  countryAlpha3: string;
  internalNickname?: string;
  assignedSalesUserId?: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

/**
 * Customer-safe projection. This is an explicit allowlist: internal nickname,
 * salesperson assignment, timestamps and any future internal field are absent.
 */
export interface CustomerCompanyDto {
  id: string;
  customerCode: string;
  shortName: string;
  countryAlpha3: string;
  status: 'active' | 'suspended';
}

export type CompanyViewDto = CompanyDto | CustomerCompanyDto;

const CUSTOMER_CODE = /^C[0-9]{6}$/;
const COUNTRY_CODE = /^[A-Z]{3}$/;
const ACCOUNT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function companyDto(row: CompanyRow): CompanyDto {
  return {
    id: row.id,
    customerCode: row.customer_code,
    shortName: row.short_name,
    countryAlpha3: row.country_alpha3,
    internalNickname: row.internal_nickname ?? undefined,
    assignedSalesUserId: row.assigned_sales_user_id ?? undefined,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function customerCompanyDto(row: CompanyRow): CustomerCompanyDto {
  return {
    id: row.id,
    customerCode: row.customer_code,
    shortName: row.short_name,
    countryAlpha3: row.country_alpha3,
    status: row.status,
  };
}

function actor(auth: AuthContext) {
  return {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
  };
}

export function deriveCustomerUsername(customerCode: string, letter: string): string {
  return `AK${customerCode.slice(1)}${letter}`;
}

async function withTransaction<T>(pool: DbPool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

async function validateAssignedSales(
  client: PoolClient,
  assignedSalesUserId: string | undefined
): Promise<void> {
  if (!assignedSalesUserId) return;
  const result = await client.query(
    `SELECT 1 FROM internal_users iu
     JOIN internal_user_roles ur ON ur.internal_user_id = iu.id
     WHERE iu.id = $1 AND iu.status = 'active' AND ur.role_id = 'sales'`,
    [assignedSalesUserId]
  );
  if (result.rowCount !== 1) {
    throw new HttpError(400, 'invalid_sales_user', 'Assigned sales user is not an active salesperson.');
  }
}

async function validateBrands(client: PoolClient, brandIds: string[]): Promise<string[]> {
  const unique = [...new Set(brandIds)];
  if (!unique.length) return [];
  const result = await client.query<{ id: string }>(
    'SELECT id FROM brands WHERE id = ANY($1::text[]) AND active = true',
    [unique]
  );
  if (result.rowCount !== unique.length) {
    throw new HttpError(400, 'invalid_brand', 'One or more brands are invalid or inactive.');
  }
  return unique;
}

async function defaultBrandIds(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM brands WHERE is_default_granted = true AND active = true'
  );
  return result.rows.map(row => row.id);
}

export interface CreateCompanyInput {
  customerCode: string;
  shortName: string;
  countryAlpha3: string;
  internalNickname?: string;
  assignedSalesUserId?: string;
  brandIds?: string[];
}

export interface CreateCompanyResult {
  company: CompanyDto;
  primaryUsername: string;
  temporaryPassword: string;
}

export async function createCompany(
  pool: DbPool,
  auth: AuthContext,
  input: CreateCompanyInput
): Promise<CreateCompanyResult> {
  const customerCode = input.customerCode.trim().toUpperCase();
  if (!CUSTOMER_CODE.test(customerCode)) {
    throw new HttpError(400, 'invalid_customer_code', 'Customer code must be C followed by 6 digits.');
  }
  const shortName = input.shortName.trim();
  if (!shortName) throw new HttpError(400, 'invalid_request', 'Company short name is required.');
  const country = input.countryAlpha3.trim().toUpperCase();
  if (!COUNTRY_CODE.test(country)) {
    throw new HttpError(400, 'invalid_country', 'Country must be a 3-letter uppercase ISO alpha-3 code.');
  }

  const temporaryPassword = generateInitialPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const companyId = randomUUID();
  const customerUserId = randomUUID();
  const username = deriveCustomerUsername(customerCode, 'A');

  return withTransaction(pool, async client => {
    const duplicate = await client.query('SELECT 1 FROM customer_companies WHERE customer_code = $1', [
      customerCode,
    ]);
    if (duplicate.rowCount !== 0) {
      throw new HttpError(409, 'duplicate_customer_code', `Customer code ${customerCode} already exists.`);
    }
    await validateAssignedSales(client, input.assignedSalesUserId);
    const brandIds = await validateBrands(
      client,
      input.brandIds?.length ? input.brandIds : await defaultBrandIds(client)
    );

    const companyResult = await client.query<CompanyRow>(
      `INSERT INTO customer_companies
        (id, customer_code, short_name, country_alpha3, internal_nickname,
         assigned_sales_user_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', now(), now())
       RETURNING *`,
      [
        companyId,
        customerCode,
        shortName,
        country,
        input.internalNickname?.trim() || null,
        input.assignedSalesUserId ?? null,
      ]
    );

    await client.query(
      `INSERT INTO customer_users
        (id, company_id, username, account_letter, password_hash, must_change_password,
         status, created_at, updated_at)
       VALUES ($1, $2, $3, 'A', $4, true, 'active', now(), now())`,
      [customerUserId, companyId, username, passwordHash]
    );

    for (const brandId of brandIds) {
      await client.query(
        'INSERT INTO brand_grants (company_id, brand_id, granted_at) VALUES ($1, $2, now())',
        [companyId, brandId]
      );
    }

    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_COMPANY',
      targetType: 'customer_company',
      targetId: companyId,
      details: { customerCode, country, brandIds },
    });
    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_CUSTOMER_USER',
      targetType: 'customer_user',
      targetId: customerUserId,
      details: { username, accountLetter: 'A', temporaryPasswordShownOnce: true },
    });

    return {
      company: companyDto(companyResult.rows[0]),
      primaryUsername: username,
      temporaryPassword,
    };
  });
}

export interface CreateSecondaryAccountResult {
  username: string;
  temporaryPassword: string;
}

export async function createSecondaryAccount(
  pool: DbPool,
  auth: AuthContext,
  companyId: string
): Promise<CreateSecondaryAccountResult> {
  const temporaryPassword = generateInitialPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  return withTransaction(pool, async client => {
    const company = await client.query<CompanyRow>(
      'SELECT * FROM customer_companies WHERE id = $1 FOR UPDATE',
      [companyId]
    );
    if (!company.rows[0]) throw new HttpError(404, 'company_not_found', 'Company not found.');

    const used = await client.query<{ account_letter: string }>(
      'SELECT account_letter FROM customer_users WHERE company_id = $1',
      [companyId]
    );
    const usedLetters = new Set(used.rows.map(row => row.account_letter));
    const letter = [...ACCOUNT_LETTERS].find(candidate => !usedLetters.has(candidate));
    if (!letter) {
      throw new HttpError(409, 'account_limit', 'This company already has 26 accounts (A-Z).');
    }
    const username = deriveCustomerUsername(company.rows[0].customer_code, letter);
    const id = randomUUID();
    await client.query(
      `INSERT INTO customer_users
        (id, company_id, username, account_letter, password_hash, must_change_password,
         status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, 'active', now(), now())`,
      [id, companyId, username, letter, passwordHash]
    );
    await writeAudit(client, {
      ...actor(auth),
      action: 'CREATE_CUSTOMER_USER',
      targetType: 'customer_user',
      targetId: id,
      details: { companyId, username, accountLetter: letter, temporaryPasswordShownOnce: true },
    });
    return { username, temporaryPassword };
  });
}

export async function listAllCompanies(pool: DbPool): Promise<CompanyDto[]> {
  const result = await pool.query<CompanyRow>(
    'SELECT * FROM customer_companies ORDER BY created_at DESC'
  );
  return result.rows.map(companyDto);
}

export async function listCompaniesForAuth(
  pool: DbPool,
  auth: AuthContext
): Promise<CompanyViewDto[]> {
  if (auth.user.type === 'customer' && auth.user.companyId) {
    const result = await pool.query<CompanyRow>('SELECT * FROM customer_companies WHERE id = $1', [
      auth.user.companyId,
    ]);
    return result.rows.map(customerCompanyDto);
  }
  if (auth.user.permissions.includes('sales.read_all')) {
    return listAllCompanies(pool);
  }
  if (auth.user.permissions.includes('sales.read_assigned')) {
    const result = await pool.query<CompanyRow>(
      'SELECT * FROM customer_companies WHERE assigned_sales_user_id = $1 ORDER BY created_at DESC',
      [auth.user.id]
    );
    return result.rows.map(companyDto);
  }
  throw new HttpError(403, 'forbidden', 'You do not have access to customer companies.');
}

export async function getCompanyForAuth(
  pool: DbPool,
  auth: AuthContext,
  companyId: string
): Promise<CompanyViewDto> {
  const result = await pool.query<CompanyRow>('SELECT * FROM customer_companies WHERE id = $1', [
    companyId,
  ]);
  const company = result.rows[0];
  if (!company) throw new HttpError(404, 'company_not_found', 'Company not found.');

  if (auth.user.type === 'customer') {
    if (company.id !== auth.user.companyId) {
      throw new HttpError(404, 'company_not_found', 'Company not found.');
    }
    return customerCompanyDto(company);
  }

  if (auth.user.permissions.includes('sales.read_all')) return companyDto(company);
  if (
    auth.user.permissions.includes('sales.read_assigned') &&
    company.assigned_sales_user_id === auth.user.id
  ) {
    return companyDto(company);
  }
  throw new HttpError(403, 'forbidden', 'You do not have access to this company.');
}

export async function setCompanyStatus(
  pool: DbPool,
  auth: AuthContext,
  companyId: string,
  status: 'active' | 'suspended'
): Promise<CompanyDto> {
  return withTransaction(pool, async client => {
    const result = await client.query<CompanyRow>(
      `UPDATE customer_companies SET status = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [companyId, status]
    );
    if (!result.rows[0]) throw new HttpError(404, 'company_not_found', 'Company not found.');
    if (status === 'suspended') {
      await client.query(
        'UPDATE auth_sessions SET revoked_at = now() WHERE company_id = $1 AND revoked_at IS NULL',
        [companyId]
      );
    }
    await writeAudit(client, {
      ...actor(auth),
      action: status === 'suspended' ? 'SUSPEND_COMPANY' : 'REACTIVATE_COMPANY',
      targetType: 'customer_company',
      targetId: companyId,
      details: {
        status,
        pendingOrdersContract:
          status === 'suspended' ? 'future_pending_orders_must_be_cancelled_phase_4b03' : undefined,
      },
    });
    return companyDto(result.rows[0]);
  });
}

export async function setCustomerStatus(
  pool: DbPool,
  auth: AuthContext,
  customerUserId: string,
  status: 'active' | 'suspended'
): Promise<void> {
  await withTransaction(pool, async client => {
    const result = await client.query(
      `UPDATE customer_users SET status = $2, updated_at = now()
       WHERE id = $1 RETURNING company_id, username`,
      [customerUserId, status]
    );
    if (!result.rows[0]) throw new HttpError(404, 'customer_not_found', 'Customer account not found.');
    if (status === 'suspended') {
      await client.query(
        'UPDATE auth_sessions SET revoked_at = now() WHERE customer_user_id = $1 AND revoked_at IS NULL',
        [customerUserId]
      );
    }
    await writeAudit(client, {
      ...actor(auth),
      action: status === 'suspended' ? 'SUSPEND_CUSTOMER' : 'REACTIVATE_CUSTOMER',
      targetType: 'customer_user',
      targetId: customerUserId,
      details: { status, companyId: result.rows[0].company_id, username: result.rows[0].username },
    });
  });
}

export async function setBrandGrant(
  pool: DbPool,
  auth: AuthContext,
  companyId: string,
  brandId: string,
  granted: boolean
): Promise<void> {
  await withTransaction(pool, async client => {
    const company = await client.query('SELECT 1 FROM customer_companies WHERE id = $1', [companyId]);
    if (company.rowCount !== 1) throw new HttpError(404, 'company_not_found', 'Company not found.');
    const brand = await client.query('SELECT 1 FROM brands WHERE id = $1', [brandId]);
    if (brand.rowCount !== 1) throw new HttpError(404, 'brand_not_found', 'Brand not found.');
    if (granted) {
      await client.query(
        `INSERT INTO brand_grants (company_id, brand_id, granted_at)
         VALUES ($1, $2, now()) ON CONFLICT (company_id, brand_id) DO NOTHING`,
        [companyId, brandId]
      );
    } else {
      await client.query('DELETE FROM brand_grants WHERE company_id = $1 AND brand_id = $2', [
        companyId,
        brandId,
      ]);
    }
    await writeAudit(client, {
      ...actor(auth),
      action: granted ? 'GRANT_BRAND' : 'REVOKE_BRAND',
      targetType: 'customer_company',
      targetId: companyId,
      details: { brandId },
    });
  });
}

export async function setSalesAssignment(
  pool: DbPool,
  auth: AuthContext,
  companyId: string,
  salesUserId: string | null
): Promise<CompanyDto> {
  return withTransaction(pool, async client => {
    if (salesUserId) await validateAssignedSales(client, salesUserId);
    const result = await client.query<CompanyRow>(
      `UPDATE customer_companies SET assigned_sales_user_id = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [companyId, salesUserId]
    );
    if (!result.rows[0]) throw new HttpError(404, 'company_not_found', 'Company not found.');
    await writeAudit(client, {
      ...actor(auth),
      action: 'ASSIGN_SALES',
      targetType: 'customer_company',
      targetId: companyId,
      details: { salesUserId },
    });
    return companyDto(result.rows[0]);
  });
}

export async function acknowledgeSalesWrite(
  pool: DbPool,
  auth: AuthContext,
  companyId: string
): Promise<void> {
  const company = await pool.query<{ assigned_sales_user_id: string | null }>(
    'SELECT assigned_sales_user_id FROM customer_companies WHERE id = $1',
    [companyId]
  );
  if (!company.rows[0]) throw new HttpError(404, 'company_not_found', 'Company not found.');
  const canReadAll = auth.user.permissions.includes('sales.read_all');
  const isAssigned = company.rows[0].assigned_sales_user_id === auth.user.id;
  if (!canReadAll && !isAssigned) {
    throw new HttpError(403, 'forbidden', 'You are not assigned to this customer company.');
  }
  await writeAudit(pool, {
    ...actor(auth),
    action: 'SALES_WRITE_ACKNOWLEDGED',
    targetType: 'customer_company',
    targetId: companyId,
    details: { writePermission: 'sales.write' },
  });
}
