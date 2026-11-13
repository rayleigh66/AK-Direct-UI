import type { DbPool } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import { buildInternalOrder, orderRow, type InternalOrderDto } from './dto.js';

export type ApprovalType = 'price' | 'extension' | 'release';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

const APPROVAL_PERMISSIONS: Record<ApprovalType, string> = {
  price: 'orders.approve_price',
  extension: 'orders.approve_extension',
  release: 'orders.approve_release',
};

export function parseApprovalType(value: unknown): ApprovalType {
  if (value === 'price' || value === 'extension' || value === 'release') return value;
  throw new HttpError(400, 'invalid_approval_type', 'type must be price, extension or release.');
}

export function parseApprovalStatus(value: unknown): ApprovalStatus {
  if (value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED') return value;
  if (value === undefined || value === null || value === '') return 'PENDING';
  throw new HttpError(400, 'invalid_approval_status', 'status must be PENDING, APPROVED or REJECTED.');
}

function requireRead(auth: AuthContext, type: ApprovalType): void {
  if (auth.user.type !== 'internal') {
    throw new HttpError(403, 'forbidden', 'An internal session is required.');
  }
  if (!auth.user.permissions.includes(APPROVAL_PERMISSIONS[type])) {
    throw new HttpError(403, 'forbidden', `The ${APPROVAL_PERMISSIONS[type]} permission is required.`);
  }
}

export interface ApprovalSummary {
  id: string;
  type: ApprovalType;
  orderId: string;
  orderNo: string;
  companyCode: string;
  companyShortName: string;
  status: ApprovalStatus;
  requestedAt: string;
  requestedByLabel: string;
  summary: string;
}

export async function listOrderApprovals(
  pool: DbPool,
  auth: AuthContext,
  type: ApprovalType,
  status: ApprovalStatus
): Promise<ApprovalSummary[]> {
  requireRead(auth, type);
  if (type === 'price') {
    const rows = await pool.query<{
      id: string;
      order_id: string;
      status: ApprovalStatus;
      requested_at: Date;
      requested_by_label: string;
      order_no: string;
      customer_code: string;
      short_name: string;
      requested_plan_version: number;
      plan_total_cents: string | null;
    }>(
      `SELECT a.id, a.order_id, a.status, a.requested_at, a.requested_by_label,
              o.order_no, c.customer_code, c.short_name,
              a.requested_plan_version, p.total_cents AS plan_total_cents
       FROM order_price_approvals a
       JOIN orders o ON o.id = a.order_id
       JOIN customer_companies c ON c.id = o.company_id
       LEFT JOIN order_plans p ON p.id = a.requested_plan_id
       WHERE a.status = $1
       ORDER BY a.requested_at, a.id`,
      [status]
    );
    return rows.rows.map(row => ({
      id: row.id,
      type,
      orderId: row.order_id,
      orderNo: row.order_no,
      companyCode: row.customer_code,
      companyShortName: row.short_name,
      status: row.status,
      requestedAt: new Date(row.requested_at).toISOString(),
      requestedByLabel: row.requested_by_label,
      summary: `Plan v${row.requested_plan_version} · ` +
        (row.plan_total_cents ? `USD ${(Number(row.plan_total_cents) / 100).toFixed(2)}` : 'changed price'),
    }));
  }
  if (type === 'extension') {
    const rows = await pool.query<{
      id: string;
      order_id: string;
      status: ApprovalStatus;
      requested_at: Date;
      requested_by_label: string;
      order_no: string;
      customer_code: string;
      short_name: string;
      additional_hours: number;
      expires_at: Date;
    }>(
      `SELECT e.id, e.order_id, e.status, e.requested_at, e.requested_by_label,
              o.order_no, c.customer_code, c.short_name, e.additional_hours, r.expires_at
       FROM order_extension_requests e
       JOIN orders o ON o.id = e.order_id
       JOIN customer_companies c ON c.id = o.company_id
       JOIN order_reservations r ON r.order_id = e.order_id
       WHERE e.status = $1
       ORDER BY e.requested_at, e.id`,
      [status]
    );
    return rows.rows.map(row => ({
      id: row.id,
      type,
      orderId: row.order_id,
      orderNo: row.order_no,
      companyCode: row.customer_code,
      companyShortName: row.short_name,
      status: row.status,
      requestedAt: new Date(row.requested_at).toISOString(),
      requestedByLabel: row.requested_by_label,
      summary: `+${row.additional_hours}h · current deadline ${new Date(row.expires_at).toISOString()}`,
    }));
  }
  const rows = await pool.query<{
    id: string;
    order_id: string;
    status: ApprovalStatus;
    requested_at: Date;
    requested_by_label: string;
    order_no: string;
    customer_code: string;
    short_name: string;
    reason: string;
  }>(
    `SELECT q.id, q.order_id, q.status, q.requested_at, q.requested_by_label,
            o.order_no, c.customer_code, c.short_name, q.reason
     FROM order_release_requests q
     JOIN orders o ON o.id = q.order_id
     JOIN customer_companies c ON c.id = o.company_id
     WHERE q.status = $1
     ORDER BY q.requested_at, q.id`,
    [status]
  );
  return rows.rows.map(row => ({
    id: row.id,
    type,
    orderId: row.order_id,
    orderNo: row.order_no,
    companyCode: row.customer_code,
    companyShortName: row.short_name,
    status: row.status,
    requestedAt: new Date(row.requested_at).toISOString(),
    requestedByLabel: row.requested_by_label,
    summary: row.reason,
  }));
}

export interface ApprovalDetail {
  type: ApprovalType;
  request: Record<string, unknown>;
  order: InternalOrderDto;
}

async function priceRequest(
  pool: DbPool,
  id: string
): Promise<{ request: Record<string, unknown>; orderId: string; requestedPlanId: string } | null> {
  const result = await pool.query<{
    id: string;
    order_id: string;
    requested_plan_id: string;
    requested_plan_version: number;
    price_fingerprint: string;
    price_epoch: string;
    status: ApprovalStatus;
    requested_by_label: string;
    requested_at: Date;
    decided_by_label: string | null;
    decided_at: Date | null;
    decided_plan_version: number | null;
    decision_note: string | null;
    reason: string;
  }>('SELECT * FROM order_price_approvals WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    orderId: row.order_id,
    requestedPlanId: row.requested_plan_id,
    request: {
      id: row.id,
      orderId: row.order_id,
      requestedPlanId: row.requested_plan_id,
      requestedPlanVersion: row.requested_plan_version,
      priceFingerprint: row.price_fingerprint,
      priceEpoch: Number(row.price_epoch),
      status: row.status,
      requestedByLabel: row.requested_by_label,
      requestedAt: new Date(row.requested_at).toISOString(),
      decidedByLabel: row.decided_by_label,
      decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
      decidedPlanVersion: row.decided_plan_version,
      decisionNote: row.decision_note,
      reason: row.reason,
    },
  };
}

async function extensionRequest(
  pool: DbPool,
  id: string
): Promise<{ request: Record<string, unknown>; orderId: string } | null> {
  const result = await pool.query<{
    id: string;
    order_id: string;
    status: ApprovalStatus;
    requested_by_user_id: string;
    requested_by_label: string;
    additional_hours: number;
    reason: string;
    expected_expires_at: Date;
    expected_reservation_version: string;
    requested_at: Date;
    decided_by_label: string | null;
    decided_at: Date | null;
    decision_note: string | null;
    previous_expires_at: Date | null;
    new_expires_at: Date | null;
  }>('SELECT * FROM order_extension_requests WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    orderId: row.order_id,
    request: {
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      requestedByUserId: row.requested_by_user_id,
      requestedByLabel: row.requested_by_label,
      additionalHours: row.additional_hours,
      reason: row.reason,
      expectedExpiresAt: new Date(row.expected_expires_at).toISOString(),
      expectedReservationVersion: Number(row.expected_reservation_version),
      requestedAt: new Date(row.requested_at).toISOString(),
      decidedByLabel: row.decided_by_label,
      decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
      decisionNote: row.decision_note,
      previousExpiresAt: row.previous_expires_at
        ? new Date(row.previous_expires_at).toISOString()
        : null,
      newExpiresAt: row.new_expires_at ? new Date(row.new_expires_at).toISOString() : null,
    },
  };
}

async function releaseRequest(
  pool: DbPool,
  id: string
): Promise<{ request: Record<string, unknown>; orderId: string } | null> {
  const result = await pool.query<{
    id: string;
    order_id: string;
    status: ApprovalStatus;
    requested_by_user_id: string;
    requested_by_label: string;
    reason: string;
    payment_verification: string;
    shipment_verification: string;
    verification_note: string;
    verified_by_user_id: string;
    verified_at: Date;
    expected_reservation_version: string;
    requested_at: Date;
    decided_by_label: string | null;
    decided_at: Date | null;
    decision_note: string | null;
    executed_at: Date | null;
  }>('SELECT * FROM order_release_requests WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    orderId: row.order_id,
    request: {
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      requestedByUserId: row.requested_by_user_id,
      requestedByLabel: row.requested_by_label,
      reason: row.reason,
      paymentVerification: row.payment_verification,
      shipmentVerification: row.shipment_verification,
      verificationNote: row.verification_note,
      verifiedByUserId: row.verified_by_user_id,
      verifiedAt: new Date(row.verified_at).toISOString(),
      expectedReservationVersion: Number(row.expected_reservation_version),
      requestedAt: new Date(row.requested_at).toISOString(),
      decidedByLabel: row.decided_by_label,
      decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
      decisionNote: row.decision_note,
      executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : null,
    },
  };
}

export async function getOrderApproval(
  pool: DbPool,
  auth: AuthContext,
  type: ApprovalType,
  id: string
): Promise<ApprovalDetail> {
  requireRead(auth, type);
  const loaded =
    type === 'price'
      ? await priceRequest(pool, id)
      : type === 'extension'
        ? await extensionRequest(pool, id)
        : await releaseRequest(pool, id);
  if (!loaded) throw new HttpError(404, 'approval_not_found', 'Approval request not found.');
  const row = await orderRow(pool, 'WHERE o.id = $1', [loaded.orderId]);
  if (!row) throw new HttpError(404, 'order_not_found', 'Order not found.');
  const order = await buildInternalOrder(pool, row);
  let requestedPlan: unknown = null;
  if (type === 'price') {
    const planId = (loaded as { requestedPlanId?: string }).requestedPlanId;
    if (planId) {
    const plan = await pool.query<{
      id: string;
      plan_version: number;
      status: string;
      plan_digest: string;
      price_fingerprint: string;
      price_epoch: string;
      total_cents: string;
      quantity_total: number;
      requires_price_approval: boolean;
    }>('SELECT * FROM order_plans WHERE id = $1', [planId]);
    const lines = await pool.query(
      `SELECT line_number, sku_id, sku_code, product_code, quantity,
              reference_unit_price_cents, unit_price_cents, line_total_cents,
              price_changed
       FROM order_plan_lines WHERE plan_id = $1 ORDER BY line_number`,
      [planId]
    );
    if (plan.rows[0]) {
      requestedPlan = {
        ...plan.rows[0],
        total_cents: Number(plan.rows[0].total_cents),
        price_epoch: Number(plan.rows[0].price_epoch),
        lines: lines.rows.map(line => ({
          lineNumber: line.line_number,
          skuId: line.sku_id,
          skuCode: line.sku_code,
          productCode: line.product_code,
          quantity: line.quantity,
          referenceUnitPriceCents: line.reference_unit_price_cents,
          unitPriceCents: line.unit_price_cents,
          lineTotalCents: Number(line.line_total_cents),
          priceChanged: line.price_changed,
        })),
      };
    }
    }
  }
  return {
    type,
    request: { ...loaded.request, requestedPlan },
    order,
  };
}
