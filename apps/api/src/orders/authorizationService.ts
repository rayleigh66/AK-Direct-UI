import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import { actionPayloadDigest, requireIdempotencyKey } from './planValidation.js';
import { replayIdempotentResult, storeIdempotentResult } from './idempotency.js';
import { assertCurrentSession } from './access.js';

export interface BuyerAuthorizationDto {
  id: string;
  companyId: string;
  customerUserId: string;
  username: string;
  accountLetter: string;
  status: 'active' | 'revoked';
  version: number;
  authorizedByLabel: string;
  authorizedAt: string;
  revokedByLabel: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

interface AuthorizationRow {
  id: string;
  company_id: string;
  customer_user_id: string;
  status: 'active' | 'revoked';
  version: string;
  authorized_at: Date;
  authorized_by_label: string;
  revoked_at: Date | null;
  revoked_by_label: string | null;
  revoke_reason: string | null;
  username: string;
  account_letter: string;
}

const AUTHORIZATION_SELECT = `
  SELECT a.id, a.company_id, a.customer_user_id, a.status, a.version,
         a.authorized_at, ab.email AS authorized_by_label,
         a.revoked_at, rb.email AS revoked_by_label, a.revoke_reason,
         cu.username, cu.account_letter
  FROM buyer_confirmation_authorizations a
  JOIN customer_users cu ON cu.id = a.customer_user_id
  JOIN internal_users ab ON ab.id = a.authorized_by_user_id
  LEFT JOIN internal_users rb ON rb.id = a.revoked_by_user_id
`;

function authorizationDto(row: AuthorizationRow): BuyerAuthorizationDto {
  return {
    id: row.id,
    companyId: row.company_id,
    customerUserId: row.customer_user_id,
    username: row.username,
    accountLetter: row.account_letter,
    status: row.status,
    version: Number(row.version),
    authorizedByLabel: row.authorized_by_label,
    authorizedAt: new Date(row.authorized_at).toISOString(),
    revokedByLabel: row.revoked_by_label,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    revokeReason: row.revoke_reason,
  };
}

function requireConfirmerManager(auth: AuthContext): void {
  if (auth.user.type !== 'internal') {
    throw new HttpError(403, 'forbidden', 'An internal session is required.');
  }
  if (!auth.user.permissions.includes('orders.manage_confirmers')) {
    throw new HttpError(
      403,
      'forbidden',
      'The orders.manage_confirmers permission is required.'
    );
  }
}

async function loadAuthorization(
  db: Pick<DbPool, 'query'> | PoolClient,
  authorizationId: string
): Promise<BuyerAuthorizationDto | null> {
  const result = await db.query<AuthorizationRow>(
    `${AUTHORIZATION_SELECT} WHERE a.id = $1`,
    [authorizationId]
  );
  return result.rows[0] ? authorizationDto(result.rows[0]) : null;
}

export async function listBuyerAuthorizations(
  pool: DbPool,
  auth: AuthContext,
  companyId: string
): Promise<BuyerAuthorizationDto[]> {
  requireConfirmerManager(auth);
  const company = await pool.query('SELECT 1 FROM customer_companies WHERE id = $1', [companyId]);
  if (!company.rowCount) throw new HttpError(404, 'company_not_found', 'Company not found.');
  const result = await pool.query<AuthorizationRow>(
    `${AUTHORIZATION_SELECT} WHERE a.company_id = $1
     ORDER BY a.status = 'active' DESC, a.authorized_at DESC`,
    [companyId]
  );
  return result.rows.map(authorizationDto);
}

export interface ConfirmerAccountCompanyDto {
  companyId: string;
  customerCode: string;
  shortName: string;
  accounts: Array<{
    customerUserId: string;
    username: string;
    accountLetter: string;
    status: 'active' | 'suspended';
    activeAuthorizationId: string | null;
  }>;
}

/**
 * Minimal projection for the confirmation-authority manager. It deliberately
 * does not expose assigned salespeople, nicknames, order data or audit data.
 */
export async function listConfirmerAccountCompanies(
  pool: DbPool,
  auth: AuthContext
): Promise<ConfirmerAccountCompanyDto[]> {
  requireConfirmerManager(auth);
  const result = await pool.query<{
    company_id: string;
    customer_code: string;
    short_name: string;
    customer_user_id: string;
    username: string;
    account_letter: string;
    status: 'active' | 'suspended';
    active_authorization_id: string | null;
  }>(
    `SELECT c.id AS company_id, c.customer_code, c.short_name,
            cu.id AS customer_user_id, cu.username, cu.account_letter, cu.status,
            a.id AS active_authorization_id
     FROM customer_companies c
     JOIN customer_users cu ON cu.company_id = c.id
     LEFT JOIN buyer_confirmation_authorizations a
       ON a.company_id = c.id AND a.customer_user_id = cu.id AND a.status = 'active'
     ORDER BY c.customer_code, cu.account_letter`
  );
  const companies = new Map<string, ConfirmerAccountCompanyDto>();
  for (const row of result.rows) {
    let company = companies.get(row.company_id);
    if (!company) {
      company = {
        companyId: row.company_id,
        customerCode: row.customer_code,
        shortName: row.short_name,
        accounts: [],
      };
      companies.set(row.company_id, company);
    }
    company.accounts.push({
      customerUserId: row.customer_user_id,
      username: row.username,
      accountLetter: row.account_letter,
      status: row.status,
      activeAuthorizationId: row.active_authorization_id,
    });
  }
  return [...companies.values()];
}

export interface GrantBuyerAuthorizationInput {
  customerUserId: string;
  idempotencyKey: unknown;
}

export async function grantBuyerAuthorization(
  pool: DbPool,
  auth: AuthContext,
  companyId: string,
  input: GrantBuyerAuthorizationInput
): Promise<BuyerAuthorizationDto> {
  requireConfirmerManager(auth);
  const key = requireIdempotencyKey(input.idempotencyKey);
  const customerUserId =
    typeof input.customerUserId === 'string' ? input.customerUserId.trim() : '';
  if (!customerUserId) {
    throw new HttpError(400, 'invalid_request', 'customerUserId is required.');
  }
  const digest = actionPayloadDigest('GRANT_BUYER_AUTHORIZATION', {
    companyId,
    customerUserId,
  });

  return withTransaction(pool, async client => {
    const company = await client.query<{ status: string }>(
      'SELECT status FROM customer_companies WHERE id = $1 FOR UPDATE',
      [companyId]
    );
    if (!company.rows[0]) throw new HttpError(404, 'company_not_found', 'Company not found.');
    if (company.rows[0].status !== 'active') {
      throw new HttpError(409, 'company_inactive', 'The customer company is not active.');
    }
    await assertCurrentSession(client, auth, 'orders.manage_confirmers');
    const customer = await client.query<{ status: string; username: string }>(
      `SELECT status, username FROM customer_users
       WHERE id = $1 AND company_id = $2`,
      [customerUserId, companyId]
    );
    if (!customer.rows[0]) {
      throw new HttpError(
        404,
        'customer_not_found',
        'That customer account does not belong to this company.'
      );
    }
    if (customer.rows[0].status !== 'active') {
      throw new HttpError(409, 'customer_inactive', 'The customer account is not active.');
    }

    const scope = {
      operation: 'GRANT_BUYER_AUTHORIZATION',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId: null,
      companyId,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<BuyerAuthorizationDto>(client, scope);
    if (replayed) return replayed;

    const existing = await client.query(
      `SELECT 1 FROM buyer_confirmation_authorizations
       WHERE company_id = $1 AND customer_user_id = $2 AND status = 'active'`,
      [companyId, customerUserId]
    );
    if (existing.rowCount) {
      throw new HttpError(
        409,
        'already_authorized',
        'That account already holds an active buyer confirmation authorization.'
      );
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO buyer_confirmation_authorizations
        (id, company_id, customer_user_id, status, version, authorized_by_user_id, authorized_at)
       VALUES ($1, $2, $3, 'active', 1, $4, now())`,
      [id, companyId, customerUserId, auth.user.id]
    );
    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: 'GRANT_BUYER_AUTHORIZATION',
      targetType: 'customer_company',
      targetId: companyId,
      details: { customerUserId, username: customer.rows[0].username },
    });
    const result = (await loadAuthorization(client, id))!;
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

export interface RevokeBuyerAuthorizationInput {
  reason?: string;
  idempotencyKey: unknown;
}

export interface RevokeBuyerAuthorizationResult {
  authorization: BuyerAuthorizationDto;
  invalidatedAcceptances: number;
}

export async function invalidateAcceptancesForAuthorization(
  client: PoolClient,
  authorizationIds: string[],
  reason: string
): Promise<number> {
  if (!authorizationIds.length) return 0;
  // A confirmed order's acceptance is historical transaction evidence and is
  // never rewritten by a later revocation. Only an active acceptance on a
  // PENDING_CONFIRMATION order is invalidated.
  const invalidated = await client.query<{ plan_id: string }>(
    `UPDATE order_plan_acceptances a
     SET invalidated_at = now(), invalidation_reason = $2
     FROM orders o
     WHERE a.order_id = o.id
       AND a.authorization_id = ANY($1::uuid[])
       AND a.invalidated_at IS NULL
       AND o.status = 'PENDING_CONFIRMATION'
     RETURNING a.plan_id`,
    [authorizationIds, reason]
  );
  const planIds = [...new Set(invalidated.rows.map(row => row.plan_id))];
  if (planIds.length) {
    // The same plan version can be accepted again by another currently
    // authorized account without a price or quantity change, provided the
    // price approval is still valid for its fingerprint/epoch.
    await client.query(
      `UPDATE order_plans
       SET status = 'SUBMITTED', decided_at = NULL
       WHERE id = ANY($1::uuid[]) AND status = 'ACCEPTED'`,
      [planIds]
    );
  }
  return invalidated.rowCount ?? 0;
}

export async function revokeBuyerAuthorization(
  pool: DbPool,
  auth: AuthContext,
  authorizationId: string,
  input: RevokeBuyerAuthorizationInput
): Promise<RevokeBuyerAuthorizationResult> {
  requireConfirmerManager(auth);
  const key = requireIdempotencyKey(input.idempotencyKey);
  const reason =
    typeof input.reason === 'string' && input.reason.trim()
      ? input.reason.trim().slice(0, 500)
      : 'Revoked by an administrator.';
  const digest = actionPayloadDigest('REVOKE_BUYER_AUTHORIZATION', {
    authorizationId,
    reason,
  });

  return withTransaction(pool, async client => {
    const pointer = await client.query<{ company_id: string }>(
      'SELECT company_id FROM buyer_confirmation_authorizations WHERE id = $1',
      [authorizationId]
    );
    const companyId = pointer.rows[0]?.company_id;
    if (!companyId) {
      throw new HttpError(404, 'authorization_not_found', 'Authorization not found.');
    }
    await client.query('SELECT id FROM customer_companies WHERE id = $1 FOR UPDATE', [companyId]);
    await assertCurrentSession(client, auth, 'orders.manage_confirmers');
    const scope = {
      operation: 'REVOKE_BUYER_AUTHORIZATION',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId: null,
      companyId,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<RevokeBuyerAuthorizationResult>(client, scope);
    if (replayed) return replayed;

    const current = await client.query<{ status: string; customer_user_id: string }>(
      `SELECT status, customer_user_id FROM buyer_confirmation_authorizations
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [authorizationId, companyId]
    );
    if (!current.rows[0]) {
      throw new HttpError(404, 'authorization_not_found', 'Authorization not found.');
    }
    if (current.rows[0].status !== 'active') {
      throw new HttpError(409, 'authorization_already_revoked', 'This authorization is already revoked.');
    }
    await client.query(
      `UPDATE buyer_confirmation_authorizations
       SET status = 'revoked', version = version + 1, revoked_by_user_id = $2,
           revoked_at = now(), revoke_reason = $3
       WHERE id = $1`,
      [authorizationId, auth.user.id, reason]
    );
    const invalidated = await invalidateAcceptancesForAuthorization(
      client,
      [authorizationId],
      'authorization_revoked'
    );
    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: 'REVOKE_BUYER_AUTHORIZATION',
      targetType: 'customer_company',
      targetId: companyId,
      details: {
        authorizationId,
        customerUserId: current.rows[0].customer_user_id,
        invalidatedAcceptances: invalidated,
        reason,
      },
    });
    const result: RevokeBuyerAuthorizationResult = {
      authorization: (await loadAuthorization(client, authorizationId))!,
      invalidatedAcceptances: invalidated,
    };
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

/** Called inside the customer-account suspension transaction. */
export async function revokeAuthorizationsForCustomerUser(
  client: PoolClient,
  customerUserId: string,
  reason: string
): Promise<number> {
  const revoked = await client.query<{ id: string }>(
    `UPDATE buyer_confirmation_authorizations
     SET status = 'revoked', version = version + 1, revoked_at = now(),
         revoke_reason = $2
     WHERE customer_user_id = $1 AND status = 'active'
     RETURNING id`,
    [customerUserId, reason]
  );
  const ids = revoked.rows.map(row => row.id);
  return invalidateAcceptancesForAuthorization(client, ids, 'customer_suspended');
}

/** Called inside the company-suspension transaction. */
export async function revokeAuthorizationsForCompany(
  client: PoolClient,
  companyId: string,
  reason: string
): Promise<number> {
  const revoked = await client.query<{ id: string }>(
    `UPDATE buyer_confirmation_authorizations
     SET status = 'revoked', version = version + 1, revoked_at = now(),
         revoke_reason = $2
     WHERE company_id = $1 AND status = 'active'
     RETURNING id`,
    [companyId, reason]
  );
  const ids = revoked.rows.map(row => row.id);
  return invalidateAcceptancesForAuthorization(client, ids, 'company_suspended');
}

export interface ActiveAuthorizationRow {
  id: string;
  company_id: string;
  customer_user_id: string;
  version: string;
}

export async function requireActiveAuthorization(
  client: PoolClient,
  companyId: string,
  customerUserId: string,
  lock = true
): Promise<ActiveAuthorizationRow> {
  const result = await client.query<ActiveAuthorizationRow>(
    `SELECT id, company_id, customer_user_id, version
     FROM buyer_confirmation_authorizations
     WHERE company_id = $1 AND customer_user_id = $2 AND status = 'active'
     ${lock ? 'FOR UPDATE' : ''}`,
    [companyId, customerUserId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(
      403,
      'buyer_not_authorized',
      'This account is not an active buyer confirmation account for the company.'
    );
  }
  return row;
}

export async function findAuthorizationById(
  client: PoolClient,
  authorizationId: string,
  lock = true
): Promise<ActiveAuthorizationRow & { status: string }> {
  const result = await client.query<ActiveAuthorizationRow & { status: string }>(
    `SELECT id, company_id, customer_user_id, version, status
     FROM buyer_confirmation_authorizations
     WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [authorizationId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, 'authorization_not_found', 'Authorization not found.');
  }
  return row;
}
