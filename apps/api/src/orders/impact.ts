import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import { queueBusinessAdminNotifications, queueOrderNotifications } from './notifications.js';

export type ImpactKind =
  | 'product_unpublish'
  | 'sku_discontinue'
  | 'brand_revoke'
  | 'company_suspend';

export const IMPACT_KINDS: ImpactKind[] = [
  'product_unpublish',
  'sku_discontinue',
  'brand_revoke',
  'company_suspend',
];

export interface AffectedOrderSummary {
  id: string;
  orderNo: string;
  companyId: string;
  companyCode: string;
  status: string;
  revision: number;
  referenceTotalCents: number;
  submittedAt: string;
}

export interface OrderImpact {
  kind: ImpactKind;
  targetId: string;
  companyId: string | null;
  affectedOrders: AffectedOrderSummary[];
  impactToken: string;
}

interface AffectedRow {
  id: string;
  order_no: string;
  company_id: string;
  customer_code: string;
  status: string;
  revision: string;
  reference_total_cents: string;
  submitted_at: Date;
}

function targetKey(kind: ImpactKind, targetId: string, companyId?: string | null): string {
  return kind === 'brand_revoke' ? `${kind}:${companyId ?? ''}:${targetId}` : `${kind}:${targetId}`;
}

function conditions(
  kind: ImpactKind,
  targetId: string,
  companyId?: string | null
): { where: string; values: unknown[] } {
  switch (kind) {
    case 'product_unpublish':
      return {
        where: `EXISTS (
          SELECT 1 FROM order_items oi
          JOIN product_skus s ON s.id = oi.sku_id
          WHERE oi.order_id = o.id AND s.product_id = $1
        )`,
        values: [targetId],
      };
    case 'sku_discontinue':
      return {
        where: `EXISTS (
          SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.sku_id = $1
        )`,
        values: [targetId],
      };
    case 'brand_revoke':
      return {
        where: `o.company_id = $2 AND EXISTS (
          SELECT 1 FROM order_items oi
          JOIN product_skus s ON s.id = oi.sku_id
          JOIN products p ON p.id = s.product_id
          WHERE oi.order_id = o.id AND p.brand_id = $1
        )`,
        values: [targetId, companyId ?? ''],
      };
    case 'company_suspend':
      return { where: 'o.company_id = $1', values: [targetId] };
  }
}

const AFFECTED_SELECT = `
  SELECT o.id, o.order_no, o.company_id, c.customer_code, o.status, o.revision,
         o.reference_total_cents, o.submitted_at
  FROM orders o
  JOIN customer_companies c ON c.id = o.company_id
  WHERE o.status = 'PENDING_CONFIRMATION' AND
`;

function impactTokenFor(
  kind: ImpactKind,
  targetId: string,
  companyId: string | null,
  rows: AffectedRow[]
): string {
  const canonical = rows
    .map(row => `${row.id}:${row.revision}`)
    .sort()
    .join(',');
  return createHash('sha256')
    .update(`${targetKey(kind, targetId, companyId)}|${canonical}`, 'utf8')
    .digest('hex');
}

function summary(row: AffectedRow): AffectedOrderSummary {
  return {
    id: row.id,
    orderNo: row.order_no,
    companyId: row.company_id,
    companyCode: row.customer_code,
    status: row.status,
    revision: Number(row.revision),
    referenceTotalCents: Number(row.reference_total_cents),
    submittedAt: new Date(row.submitted_at).toISOString(),
  };
}

function impactFrom(
  kind: ImpactKind,
  targetId: string,
  companyId: string | null,
  rows: AffectedRow[]
): OrderImpact {
  return {
    kind,
    targetId,
    companyId,
    affectedOrders: rows.map(summary),
    impactToken: impactTokenFor(kind, targetId, companyId, rows),
  };
}

export async function findPendingOrderImpact(
  db: Pick<DbPool, 'query'>,
  kind: ImpactKind,
  targetId: string,
  companyId?: string | null
): Promise<OrderImpact> {
  const { where, values } = conditions(kind, targetId, companyId);
  const result = await db.query<AffectedRow>(
    `${AFFECTED_SELECT} ${where} ORDER BY o.id`,
    values
  );
  return impactFrom(kind, targetId, companyId ?? null, result.rows);
}

/**
 * Phase 4B-05 guard for destructive catalogue/company actions. A confirmed
 * order's stock is held until an approved full release or exception
 * cancellation. The action is refused; nothing is silently released.
 */
export async function assertNoConfirmedReservationsAffected(
  client: PoolClient,
  kind: ImpactKind,
  targetId: string,
  companyId?: string | null
): Promise<void> {
  const { where, values } = conditions(kind, targetId, companyId);
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM orders o
     JOIN order_reservations r ON r.order_id = o.id
     WHERE o.status = 'CONFIRMED'
       AND r.status IN ('ACTIVE', 'EXPIRED')
       AND ${where}`,
    values
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) {
    throw new HttpError(
      409,
      'confirmed_orders_affected',
      `${count} confirmed order(s) still hold stock for this change. Approve a full release or exception cancellation first.`,
      undefined,
      { confirmedOrders: count }
    );
  }
}

export async function assertWarehouseHasNoActiveReservations(
  client: PoolClient,
  warehouseId: string
): Promise<void> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM order_reservation_lines rl
     JOIN order_reservations r ON r.id = rl.reservation_id
     WHERE rl.warehouse_id = $1 AND r.status IN ('ACTIVE', 'EXPIRED')`,
    [warehouseId]
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) {
    throw new HttpError(
      409,
      'confirmed_orders_affected',
      `${count} reservation line(s) still hold stock in this warehouse. Approve a full release or exception cancellation first.`,
      undefined,
      { reservationLines: count }
    );
  }
}

/**
 * Product/SKU/brand/company destructive actions are allowed to continue even
 * when a confirmed order holds stock. They must never release or cancel that
 * reservation implicitly. This records the affected confirmed orders and
 * notifies the release approvers; the stock stays held until the explicit
 * approved release path is used.
 */
export async function recordConfirmedReservationImpact(
  client: PoolClient,
  auth: AuthContext,
  kind: ImpactKind,
  targetId: string,
  companyId?: string | null
): Promise<number> {
  const { where, values } = conditions(kind, targetId, companyId);
  const rows = await client.query<{
    id: string;
    order_no: string;
    company_id: string;
    customer_code: string;
  }>(
    `SELECT DISTINCT o.id, o.order_no, o.company_id, c.customer_code
     FROM orders o
     JOIN order_reservations r ON r.order_id = o.id
     JOIN customer_companies c ON c.id = o.company_id
     WHERE o.status = 'CONFIRMED'
       AND r.status IN ('ACTIVE', 'EXPIRED')
       AND ${where}
     ORDER BY o.id
     LIMIT 50`,
    values
  );
  if (!rows.rows.length) return 0;
  for (const row of rows.rows) {
    await queueBusinessAdminNotifications(client, {
      orderId: row.id,
      companyId: row.company_id,
      orderNo: row.order_no,
      companyCode: row.customer_code,
      eventType: 'CONFIRMED_RESERVATION_EXCEPTION',
      title: `Confirmed reservation exception · ${row.order_no}`,
      message: `A destructive catalogue/company action (${kind}) affects confirmed order ${row.order_no}. Stock is still held; resolve it only through an approved release.`,
      permission: 'orders.approve_release',
    });
  }
  await writeAudit(client, {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
    action: 'CONFIRMED_RESERVATIONS_AFFECTED',
    targetType: 'order',
    targetId,
    details: {
      kind,
      targetId,
      confirmedOrders: rows.rows.length,
      orderNos: rows.rows.map(row => row.order_no),
    },
  });
  return rows.rows.length;
}

/**
 * Lock the companies with affected pending orders BEFORE any product/order
 * lock. Submission locks company -> product -> SKU; using the same order in
 * destructive admin actions avoids a company/product deadlock.
 */
export async function lockAffectedCompanies(
  client: PoolClient,
  kind: ImpactKind,
  targetId: string,
  companyId?: string | null
): Promise<void> {
  const { where, values } = conditions(kind, targetId, companyId);
  const rows = await client.query<{ company_id: string }>(
    `SELECT DISTINCT o.company_id
     FROM orders o
     WHERE o.status = 'PENDING_CONFIRMATION' AND ${where}
     ORDER BY o.company_id`,
    values
  );
  if (rows.rows.length === 0) return;
  await client.query(
    `SELECT id FROM customer_companies
     WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE`,
    [rows.rows.map(row => row.company_id)]
  );
}

export interface DestructiveOrderImpactOptions {
  confirmAffectedOrders?: boolean;
  impactToken?: string;
}

export interface EnforceImpactInput {
  kind: ImpactKind;
  targetId: string;
  companyId?: string | null;
  /** Human-readable, customer-safe reason for the cancellation. */
  reason: string;
  confirmAffectedOrders?: boolean;
  impactToken?: string;
}

/**
 * Re-computes the affected PENDING_CONFIRMATION orders inside the caller's
 * transaction, locks them, and cancels them when the administrator confirms the
 * exact preview they saw. A changed set or revision invalidates the token.
 */
export async function enforcePendingOrderImpact(
  client: PoolClient,
  auth: AuthContext,
  input: EnforceImpactInput
): Promise<AffectedOrderSummary[]> {
  // Hold company locks before order locks (company -> product -> SKU -> order).
  await lockAffectedCompanies(client, input.kind, input.targetId, input.companyId);
  const { where, values } = conditions(input.kind, input.targetId, input.companyId);
  const result = await client.query<AffectedRow>(
    `${AFFECTED_SELECT} ${where} ORDER BY o.id FOR UPDATE OF o`,
    values
  );
  const rows = result.rows;
  if (rows.length === 0) return [];

  const impact = impactFrom(input.kind, input.targetId, input.companyId ?? null, rows);
  if (!input.confirmAffectedOrders) {
    throw new HttpError(
      409,
      'pending_orders_affected',
      `${rows.length} pending order(s) would be cancelled by this action. Review the impact and confirm.`,
      undefined,
      { impact }
    );
  }
  if (!input.impactToken) {
    throw new HttpError(
      409,
      'impact_confirmation_required',
      'The order-impact preview token is required before this destructive action.',
      undefined,
      { impact }
    );
  }
  if (input.impactToken !== impact.impactToken) {
    throw new HttpError(
      409,
      'impact_changed',
      'The affected pending orders changed after the preview. Review the latest impact and confirm again.',
      undefined,
      { impact }
    );
  }

  for (const row of rows) {
    await client.query(
      `UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2,
         customer_visible_note = $3, revision = revision + 1, updated_at = now()
       WHERE id = $1`,
      [row.id, input.reason, `Order cancelled by AOKING Direct: ${input.reason}`]
    );
    await client.query(
      `INSERT INTO order_status_history
        (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
         actor_label, reason, details)
       VALUES ($1, $2, 'ADMIN_CANCELLED', 'PENDING_CONFIRMATION', 'CANCELLED',
               'internal', $3, $4, $5, $6)`,
      [
        randomUUID(),
        row.id,
        auth.user.id,
        auth.user.username,
        input.reason,
        { trigger: input.kind, targetId: input.targetId },
      ]
    );
    await queueOrderNotifications(client, {
      orderId: row.id,
      companyId: row.company_id,
      companyCode: row.customer_code,
      orderNo: row.order_no,
      eventType: 'ORDER_CANCELLED_BY_ADMIN',
      customerMessage: `Order ${row.order_no} was cancelled because ${input.reason}`,
      salesMessage: `Pending order ${row.order_no} was cancelled by an administrator (${input.kind}).`,
    });
    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: 'ADMIN_CANCEL_ORDER',
      targetType: 'order',
      targetId: row.id,
      details: { orderNo: row.order_no, trigger: input.kind, targetId: input.targetId },
    });
  }

  return rows.map(summary);
}
