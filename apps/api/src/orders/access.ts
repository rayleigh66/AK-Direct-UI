import type { PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import { ORDER_SELECT, type OrderRow } from './dto.js';
import { requireUuid } from './validation.js';

export function requireInternalSalesWrite(auth: AuthContext): void {
  if (auth.user.type !== 'internal') {
    throw new HttpError(403, 'forbidden', 'An internal session is required.');
  }
  if (!auth.user.permissions.includes('sales.write')) {
    throw new HttpError(
      403,
      'forbidden',
      'The sales.write permission is required for this action.'
    );
  }
}

export function requireInternalPermission(auth: AuthContext, permission: string): void {
  if (auth.user.type !== 'internal') {
    throw new HttpError(403, 'forbidden', 'An internal session is required.');
  }
  if (!auth.user.permissions.includes(permission)) {
    throw new HttpError(403, 'forbidden', 'You do not have permission for this action.');
  }
}

/**
 * Re-read the session, account status and (optionally) the exact current
 * permission from PostgreSQL after the caller has acquired its business locks.
 * `req.auth` is only a request-start snapshot; role/permission or session
 * revocation that commits before this check must win.
 */
export async function assertCurrentSession(
  client: PoolClient,
  auth: AuthContext,
  permission?: string
): Promise<void> {
  const result = await client.query<{
    revoked_at: Date | null;
    idle_expires_at: Date;
    absolute_expires_at: Date;
    internal_status: string | null;
    customer_status: string | null;
    company_status: string | null;
    permitted: boolean;
  }>(
    `SELECT s.revoked_at, s.idle_expires_at, s.absolute_expires_at,
            iu.status AS internal_status,
            cu.status AS customer_status,
            c.status AS company_status,
            CASE WHEN $3::text IS NULL THEN true ELSE (
              EXISTS (
                SELECT 1
                FROM internal_user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                WHERE ur.internal_user_id = s.internal_user_id
                  AND rp.permission_id = $3
              )
              OR EXISTS (
                SELECT 1 FROM internal_user_permissions up
                WHERE up.internal_user_id = s.internal_user_id
                  AND up.permission_id = $3
              )
            ) END AS permitted
     FROM auth_sessions s
     LEFT JOIN internal_users iu ON iu.id = s.internal_user_id
     LEFT JOIN customer_users cu ON cu.id = s.customer_user_id
     LEFT JOIN customer_companies c ON c.id = s.company_id
     WHERE s.id = $1
       AND (s.internal_user_id = $2 OR s.customer_user_id = $2)`,
    [auth.sessionId, auth.user.id, permission ?? null]
  );
  const row = result.rows[0];
  const now = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const at = new Date(now.rows[0].now).getTime();
  if (
    !row ||
    row.revoked_at !== null ||
    new Date(row.idle_expires_at).getTime() <= at ||
    new Date(row.absolute_expires_at).getTime() <= at
  ) {
    throw new HttpError(401, 'session_expired', 'Your session is no longer valid.');
  }
  if (auth.user.type === 'internal') {
    if (row.internal_status !== 'active') {
      throw new HttpError(403, 'account_inactive', 'The internal account is not active.');
    }
  } else if (row.customer_status !== 'active' || row.company_status !== 'active') {
    throw new HttpError(403, 'account_inactive', 'The customer account or company is not active.');
  }
  if (permission && !row.permitted) {
    throw new HttpError(
      403,
      'forbidden',
      'The current account no longer holds the permission required for this action.'
    );
  }
}

export interface LockedSalesOrder {
  order: OrderRow;
  companyId: string;
  assignedSalesUserId: string | null;
  companyStatus: string;
}

/**
 * Canonical company -> order lock order. The caller must be the company's
 * CURRENT assigned salesperson and hold sales.write; a read-all or
 * administrator role alone never satisfies this. A foreign order is reported
 * as 404 so ownership is not disclosed.
 */
export async function lockOrderForCurrentSalesWrite(
  client: PoolClient,
  auth: AuthContext,
  orderId: string
): Promise<LockedSalesOrder> {
  requireInternalSalesWrite(auth);
  requireUuid(orderId, 'orderId');
  const pointer = await client.query<{ company_id: string }>(
    'SELECT company_id FROM orders WHERE id = $1',
    [orderId]
  );
  const companyId = pointer.rows[0]?.company_id;
  if (!companyId) throw new HttpError(404, 'order_not_found', 'Order not found.');
  const company = await client.query<{
    assigned_sales_user_id: string | null;
    status: string;
  }>(
    `SELECT assigned_sales_user_id, status FROM customer_companies
     WHERE id = $1 FOR UPDATE`,
    [companyId]
  );
  const companyRow = company.rows[0];
  if (!companyRow) throw new HttpError(404, 'order_not_found', 'Order not found.');
  await assertCurrentSession(client, auth, 'sales.write');
  const row = await client.query<OrderRow>(
    `${ORDER_SELECT} WHERE o.id = $1 FOR UPDATE OF o`,
    [orderId]
  );
  const order = row.rows[0];
  if (!order) throw new HttpError(404, 'order_not_found', 'Order not found.');
  if (companyRow.assigned_sales_user_id !== auth.user.id) {
    throw new HttpError(404, 'order_not_found', 'Order not found.');
  }
  if (companyRow.status !== 'active') {
    throw new HttpError(403, 'account_inactive', 'The customer company is not active.');
  }
  return {
    order,
    companyId,
    assignedSalesUserId: companyRow.assigned_sales_user_id,
    companyStatus: companyRow.status,
  };
}

/** Approval decisions do not require company ownership, but must serialize
 * with plan/reservation edits through the order row. Company is locked first so
 * no order -> company reverse path exists. */
export async function lockOrderForApproval(
  client: PoolClient,
  orderId: string
): Promise<OrderRow> {
  requireUuid(orderId, 'orderId');
  const pointer = await client.query<{ company_id: string }>(
    'SELECT company_id FROM orders WHERE id = $1',
    [orderId]
  );
  const companyId = pointer.rows[0]?.company_id;
  if (!companyId) throw new HttpError(404, 'order_not_found', 'Order not found.');
  await client.query('SELECT id FROM customer_companies WHERE id = $1 FOR UPDATE', [companyId]);
  const row = await client.query<OrderRow>(
    `${ORDER_SELECT} WHERE o.id = $1 FOR UPDATE OF o`,
    [orderId]
  );
  const order = row.rows[0];
  if (!order) throw new HttpError(404, 'order_not_found', 'Order not found.');
  return order;
}

/**
 * Confirmation is the one order write that re-reads catalogue state. The
 * catalogue destructive path is company -> product -> SKU -> order, so this
 * function takes the needed product/SKU shared locks BEFORE the order lock.
 * Every other order write is company -> order.
 */
export async function lockOrderForConfirmation(
  client: PoolClient,
  auth: AuthContext,
  orderId: string,
  planVersion: number
): Promise<LockedSalesOrder> {
  requireInternalSalesWrite(auth);
  requireUuid(orderId, 'orderId');
  const pointer = await client.query<{ company_id: string }>(
    'SELECT company_id FROM orders WHERE id = $1',
    [orderId]
  );
  const companyId = pointer.rows[0]?.company_id;
  if (!companyId) throw new HttpError(404, 'order_not_found', 'Order not found.');
  const company = await client.query<{
    assigned_sales_user_id: string | null;
    status: string;
  }>(
    `SELECT assigned_sales_user_id, status FROM customer_companies
     WHERE id = $1 FOR UPDATE`,
    [companyId]
  );
  const companyRow = company.rows[0];
  if (!companyRow) throw new HttpError(404, 'order_not_found', 'Order not found.');
  if (companyRow.assigned_sales_user_id !== auth.user.id) {
    throw new HttpError(404, 'order_not_found', 'Order not found.');
  }
  if (companyRow.status !== 'active') {
    throw new HttpError(403, 'account_inactive', 'The customer company is not active.');
  }
  await assertCurrentSession(client, auth, 'sales.write');

  if (planVersion >= 1) {
    const lines = await client.query<{ product_id: string; sku_id: string }>(
      `SELECT pl.product_id, pl.sku_id
       FROM order_plans p
       JOIN order_plan_lines pl ON pl.plan_id = p.id
       WHERE p.order_id = $1 AND p.plan_version = $2
       ORDER BY pl.product_id, pl.sku_id`,
      [orderId, planVersion]
    );
    if (lines.rows.length) {
      const productIds = [...new Set(lines.rows.map(row => row.product_id))].sort();
      const skuIds = [...new Set(lines.rows.map(row => row.sku_id))].sort();
      await client.query(
        'SELECT id FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [productIds]
      );
      await client.query(
        'SELECT id FROM product_skus WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [skuIds]
      );
    }
  }

  const row = await client.query<OrderRow>(
    `${ORDER_SELECT} WHERE o.id = $1 FOR UPDATE OF o`,
    [orderId]
  );
  const order = row.rows[0];
  if (!order) throw new HttpError(404, 'order_not_found', 'Order not found.');
  return {
    order,
    companyId,
    assignedSalesUserId: companyRow.assigned_sales_user_id,
    companyStatus: companyRow.status,
  };
}

export async function lockOrderPointer(
  client: PoolClient,
  orderId: string
): Promise<{ id: string; company_id: string; status: string; current_plan_version: number }> {
  const row = await client.query<{
    id: string;
    company_id: string;
    status: string;
    current_plan_version: number;
  }>(
    'SELECT id, company_id, status, current_plan_version FROM orders WHERE id = $1',
    [orderId]
  );
  const order = row.rows[0];
  if (!order) throw new HttpError(404, 'order_not_found', 'Order not found.');
  return order;
}
