import type { DbPool } from '../db/pool.js';
import { REFERENCE_PRICE_NOTE, type ShippingMethod } from './validation.js';

type Queryable = Pick<DbPool, 'query'>;

export interface OrderLineDto {
  id: string;
  lineNumber: number;
  skuId: string;
  productId: string;
  productCode: string;
  productTitle: string;
  productTitleEn: string;
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  quantity: number;
  baseUnitPriceCents: number;
  referenceUnitPriceCents: number;
  lineReferenceCents: number;
  priceSource: 'base_price';
  pricingVersion: string;
}

export interface CustomerOrderHistoryDto {
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  createdAt: string;
}

export interface InternalOrderHistoryDto extends CustomerOrderHistoryDto {
  actorType: 'customer' | 'internal' | 'system';
  actorLabel: string;
  details: Record<string, unknown>;
}

export interface PlanLineDto {
  lineNumber: number;
  skuId: string;
  productId: string;
  productCode: string;
  productTitle: string;
  productTitleEn: string;
  skuCode: string;
  colorName: string;
  colorNameEn: string;
  colorHex: string;
  quantity: number;
  referenceUnitPriceCents: number;
  unitPriceCents: number;
  lineTotalCents: number;
  priceChanged: boolean;
}

export type PriceApprovalStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUPERSEDED';

export interface AcceptanceDto {
  id: string;
  outcome: 'ACCEPTED' | 'REJECTED';
  decidedAt: string;
  /** Internal projection only. Customer DTOs never expose another account. */
  customerUsername?: string;
  reason?: string;
  invalidatedAt?: string | null;
}

export interface CustomerPlanDto {
  id: string;
  version: number;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED' | 'CONFIRMED';
  planDigest: string;
  quantityTotal: number;
  totalCents: number;
  requiresPriceApproval: boolean;
  priceApprovalStatus: PriceApprovalStatus;
  acceptanceReady: boolean;
  canAccept: boolean;
  /** Rejection is allowed while a price change is pending; acceptance is not. */
  canReject: boolean;
  lines: PlanLineDto[];
  acceptance: AcceptanceDto | null;
  createdAt: string;
}

export interface InternalPlanDto extends CustomerPlanDto {
  createdByLabel: string;
  priceApproval: {
    id: string | null;
    status: PriceApprovalStatus;
    requestedByLabel: string | null;
    requestedAt: string | null;
    decidedByLabel: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
  } | null;
}

export interface ReservationLineDto {
  lineNumber: number;
  skuId: string;
  productCode: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface ReservationDto {
  id: string;
  version: number;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
  /** Effective status uses the database clock, not the scanner's write time. */
  effectiveStatus: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
  overdue: boolean;
  confirmedAt: string;
  expiresAt: string;
  hardDeadlineAt: string;
  totalExtensionHours: number;
  releasedAt: string | null;
  releaseReason: string | null;
  lines?: ReservationLineDto[];
}

export interface FinalLineDto extends PlanLineDto {
  baseReferenceUnitPriceCents: number;
}

export interface CustomerOrderDto {
  id: string;
  orderNo: string;
  status: string;
  statusLabel: string;
  revision: number;
  lines: OrderLineDto[];
  referenceTotalCents: number;
  finalTotalCents: number | null;
  pricingMode: 'base_reference';
  pricingVersion: string;
  isReferenceQuote: boolean;
  priceNote: string;
  shippingMethod: ShippingMethod;
  destinationCountryAlpha3: string;
  expectedShipDate: string;
  shippingRequirements: string;
  customerVisibleNote: string;
  submittedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancellationKind: string | null;
  currentPlan: CustomerPlanDto | null;
  planHistory: Array<{
    version: number;
    status: string;
    totalCents: number;
    createdAt: string;
  }>;
  acceptance: AcceptanceDto | null;
  canAcceptPlan: boolean;
  canRejectPlan: boolean;
  buyerAuthorized: boolean;
  confirmation: {
    confirmedAt: string;
    finalTotalCents: number;
    finalLines: FinalLineDto[];
    reservation: ReservationDto | null;
  } | null;
  history: CustomerOrderHistoryDto[];
}

export interface InternalOrderDto extends Omit<CustomerOrderDto, 'history' | 'currentPlan'> {
  company: { id: string; customerCode: string; shortName: string };
  submittedByUsername: string;
  /** Immutable submission-time audit snapshot. */
  assignedSalesUserId: string | null;
  /** Current ownership used for sales access and notifications. */
  currentAssignedSalesUserId: string | null;
  currentPlan: InternalPlanDto | null;
  confirmation: {
    confirmedAt: string;
    finalTotalCents: number;
    finalLines: FinalLineDto[];
    reservation: ReservationDto | null;
    confirmedByLabel: string;
  } | null;
  pendingPriceApproval: boolean;
  pendingExtensionRequest: boolean;
  pendingReleaseRequest: boolean;
  history: InternalOrderHistoryDto[];
}

export interface OrderRow {
  id: string;
  order_no: string;
  company_id: string;
  submitted_by_user_id: string;
  assigned_sales_user_id: string | null;
  status: string;
  status_label: string;
  revision: string;
  shipping_method: ShippingMethod;
  destination_country_alpha3: string;
  expected_ship_date_text: string;
  shipping_requirements: string;
  pricing_mode: 'base_reference';
  pricing_version: string;
  is_reference_quote: boolean;
  reference_total_cents: string;
  final_total_cents: string | null;
  customer_visible_note: string;
  submitted_at: Date;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  cancellation_kind: string | null;
  current_plan_version: number;
  price_epoch: string;
  confirmed_at: Date | null;
  first_confirmed_at: Date | null;
  confirmed_by_user_id: string | null;
  final_plan_id: string | null;
  final_plan_version: number | null;
  company_code: string;
  company_name: string;
  submitted_by_username: string;
  current_assigned_sales_user_id: string | null;
}

interface OrderLineRow {
  id: string;
  line_number: number;
  sku_id: string;
  product_id: string;
  product_code: string;
  product_title: string;
  product_title_en: string;
  sku_code: string;
  color_name: string;
  color_name_en: string;
  color_hex: string;
  quantity: number;
  base_unit_price_cents: number;
  reference_unit_price_cents: number;
  line_reference_cents: string;
  price_source: 'base_price';
  pricing_version: string;
}

interface HistoryRow {
  event_type: string;
  from_status: string | null;
  to_status: string;
  actor_type: 'customer' | 'internal' | 'system';
  actor_id: string | null;
  actor_label: string;
  reason: string;
  details: Record<string, unknown>;
  created_at: Date;
}

export const ORDER_SELECT = `
  SELECT o.*, st.customer_label AS status_label,
         to_char(o.expected_ship_date, 'YYYY-MM-DD') AS expected_ship_date_text,
         c.customer_code AS company_code, c.short_name AS company_name,
         c.assigned_sales_user_id AS current_assigned_sales_user_id,
         u.username AS submitted_by_username
  FROM orders o
  JOIN order_statuses st ON st.id = o.status
  JOIN customer_companies c ON c.id = o.company_id
  JOIN customer_users u ON u.id = o.submitted_by_user_id
`;

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function orderLineDto(row: OrderLineRow): OrderLineDto {
  return {
    id: row.id,
    lineNumber: row.line_number,
    skuId: row.sku_id,
    productId: row.product_id,
    productCode: row.product_code,
    productTitle: row.product_title,
    productTitleEn: row.product_title_en,
    skuCode: row.sku_code,
    colorName: row.color_name,
    colorNameEn: row.color_name_en,
    colorHex: row.color_hex,
    quantity: row.quantity,
    baseUnitPriceCents: row.base_unit_price_cents,
    referenceUnitPriceCents: row.reference_unit_price_cents,
    lineReferenceCents: Number(row.line_reference_cents),
    priceSource: row.price_source,
    pricingVersion: row.pricing_version,
  };
}

const CUSTOMER_EVENT_LABELS: Record<string, string> = {
  SUBMITTED: 'Order submitted',
  LINES_MODIFIED: 'Quantities updated',
  CANCELLED: 'Order cancelled by customer',
  ADMIN_CANCELLED: 'Order cancelled by AOKING Direct',
  PLAN_SUBMITTED: 'Plan submitted for review',
  PLAN_ACCEPTED: 'Plan accepted by the buyer confirmer',
  PLAN_REJECTED: 'Plan returned to sales',
  PRICE_APPROVED: 'Price change approved',
  PRICE_REJECTED: 'Price change declined',
  CONFIRMED: 'Order confirmed and stock reserved',
  RESERVATION_EXPIRED: 'Reservation expired',
  RESERVATION_EXTENDED: 'Reservation deadline extended',
  RESERVATION_RELEASED: 'Reservation released and order cancelled',
};

/** Customer-visible reasons only. Internal decision notes never leak. */
const CUSTOMER_VISIBLE_REASON_EVENTS = new Set([
  'SUBMITTED',
  'LINES_MODIFIED',
  'CANCELLED',
  'ADMIN_CANCELLED',
  'PLAN_REJECTED',
]);

export async function loadLines(db: Queryable, orderId: string): Promise<OrderLineRow[]> {
  const result = await db.query<OrderLineRow>(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_number',
    [orderId]
  );
  return result.rows;
}

export async function loadHistory(db: Queryable, orderId: string): Promise<HistoryRow[]> {
  const result = await db.query<HistoryRow>(
    'SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id',
    [orderId]
  );
  return result.rows;
}

export async function orderRow(
  db: Queryable,
  where: string,
  values: unknown[]
): Promise<OrderRow | null> {
  const result = await db.query<OrderRow>(`${ORDER_SELECT} ${where}`, values);
  return result.rows[0] ?? null;
}

interface PlanRow {
  id: string;
  order_id: string;
  plan_version: number;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED' | 'CONFIRMED';
  created_by_user_id: string;
  created_by_label: string;
  plan_digest: string;
  price_fingerprint: string;
  price_epoch: string;
  requires_price_approval: boolean;
  quantity_total: number;
  total_cents: string;
  created_at: Date;
  decided_at: Date | null;
}

interface PlanLineRow {
  line_number: number;
  sku_id: string;
  product_id: string;
  product_code: string;
  product_title: string;
  product_title_en: string;
  sku_code: string;
  color_name: string;
  color_name_en: string;
  color_hex: string;
  quantity: number;
  reference_unit_price_cents: number;
  unit_price_cents: number;
  line_total_cents: string;
  price_changed: boolean;
}

interface ApprovalRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  requested_by_label: string;
  requested_at: Date;
  decided_by_label: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  price_fingerprint: string;
  price_epoch: string;
  requested_plan_version: number;
}

interface AcceptanceRow {
  id: string;
  outcome: 'ACCEPTED' | 'REJECTED';
  customer_username: string;
  reason: string;
  created_at: Date;
  invalidated_at: Date | null;
}

interface ReservationRow {
  id: string;
  order_id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
  reservation_version: string;
  confirmed_at: Date;
  expires_at: Date;
  hard_deadline_at: Date;
  total_extension_hours: number;
  released_at: Date | null;
  release_reason: string | null;
}

interface ReservationLineRow {
  line_number: number;
  sku_id: string;
  product_code: string;
  sku_code: string;
  warehouse_id: string;
  warehouse_code: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: string;
}

function planLineDto(row: PlanLineRow): PlanLineDto {
  return {
    lineNumber: row.line_number,
    skuId: row.sku_id,
    productId: row.product_id,
    productCode: row.product_code,
    productTitle: row.product_title,
    productTitleEn: row.product_title_en,
    skuCode: row.sku_code,
    colorName: row.color_name,
    colorNameEn: row.color_name_en,
    colorHex: row.color_hex,
    quantity: row.quantity,
    referenceUnitPriceCents: row.reference_unit_price_cents,
    unitPriceCents: row.unit_price_cents,
    lineTotalCents: Number(row.line_total_cents),
    priceChanged: row.price_changed,
  };
}

async function planLines(db: Queryable, planId: string): Promise<PlanLineRow[]> {
  const result = await db.query<PlanLineRow>(
    'SELECT * FROM order_plan_lines WHERE plan_id = $1 ORDER BY line_number',
    [planId]
  );
  return result.rows;
}

async function activeAcceptance(
  db: Queryable,
  orderId: string
): Promise<AcceptanceRow | null> {
  const result = await db.query<AcceptanceRow>(
    `SELECT id, outcome, customer_username, reason, created_at, invalidated_at
     FROM order_plan_acceptances
     WHERE order_id = $1 AND outcome = 'ACCEPTED' AND invalidated_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [orderId]
  );
  return result.rows[0] ?? null;
}

async function priceApprovalFor(
  db: Queryable,
  orderId: string,
  plan: PlanRow
): Promise<ApprovalRow | null> {
  const result = await db.query<ApprovalRow>(
    `SELECT id, status, requested_by_label, requested_at, decided_by_label,
            decided_at, decision_note, price_fingerprint, price_epoch,
            requested_plan_version
     FROM order_price_approvals
     WHERE order_id = $1
       AND price_fingerprint = $2
       AND price_epoch = $3
       AND status IN ('PENDING', 'APPROVED', 'REJECTED')
     ORDER BY CASE status WHEN 'APPROVED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,
              requested_at DESC
     LIMIT 1`,
    [orderId, plan.price_fingerprint, plan.price_epoch]
  );
  return result.rows[0] ?? null;
}

function approvalStatus(plan: PlanRow, approval: ApprovalRow | null): PriceApprovalStatus {
  if (!plan.requires_price_approval) return 'NOT_REQUIRED';
  return approval?.status ?? 'PENDING';
}

async function buildPlan(
  db: Queryable,
  row: OrderRow,
  internal: boolean
): Promise<CustomerPlanDto | InternalPlanDto | null> {
  if (row.current_plan_version < 1) return null;
  const planResult = await db.query<PlanRow>(
    'SELECT * FROM order_plans WHERE order_id = $1 AND plan_version = $2',
    [row.id, row.current_plan_version]
  );
  const plan = planResult.rows[0];
  if (!plan) return null;
  const lines = (await planLines(db, plan.id)).map(planLineDto);
  const approval = await priceApprovalFor(db, row.id, plan);
  const status = approvalStatus(plan, approval);
  const acceptance = await activeAcceptance(db, row.id);
  const acceptanceDto: AcceptanceDto | null = acceptance
    ? {
        id: acceptance.id,
        outcome: acceptance.outcome,
        decidedAt: new Date(acceptance.created_at).toISOString(),
        ...(internal
          ? {
              customerUsername: acceptance.customer_username,
              reason: acceptance.reason,
              invalidatedAt: acceptance.invalidated_at
                ? new Date(acceptance.invalidated_at).toISOString()
                : null,
            }
          : {}),
      }
    : null;
  const base: CustomerPlanDto = {
    id: plan.id,
    version: plan.plan_version,
    status: plan.status,
    planDigest: plan.plan_digest,
    quantityTotal: plan.quantity_total,
    totalCents: Number(plan.total_cents),
    requiresPriceApproval: plan.requires_price_approval,
    priceApprovalStatus: status,
    acceptanceReady: status === 'NOT_REQUIRED' || status === 'APPROVED',
    canAccept: false,
    canReject: false,
    lines,
    acceptance: acceptanceDto,
    createdAt: new Date(plan.created_at).toISOString(),
  };
  if (!internal) return base;
  return {
    ...base,
    createdByLabel: plan.created_by_label,
    priceApproval: plan.requires_price_approval
      ? {
          id: approval?.id ?? null,
          status,
          requestedByLabel: approval?.requested_by_label ?? null,
          requestedAt: approval ? new Date(approval.requested_at).toISOString() : null,
          decidedByLabel: approval?.decided_by_label ?? null,
          decidedAt: approval?.decided_at
            ? new Date(approval.decided_at).toISOString()
            : null,
          decisionNote: approval?.decision_note ?? null,
        }
      : null,
  };
}

async function buildReservation(
  db: Queryable,
  orderId: string,
  internal: boolean
): Promise<ReservationDto | null> {
  const result = await db.query<ReservationRow>(
    'SELECT * FROM order_reservations WHERE order_id = $1',
    [orderId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const nowRow = await db.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const now = new Date(nowRow.rows[0].now).getTime();
  const expired = row.status === 'ACTIVE' && new Date(row.expires_at).getTime() <= now;
  const effectiveStatus = expired ? 'EXPIRED' : row.status;
  const dto: ReservationDto = {
    id: row.id,
    version: Number(row.reservation_version),
    status: row.status,
    effectiveStatus,
    overdue: effectiveStatus === 'EXPIRED',
    confirmedAt: new Date(row.confirmed_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    hardDeadlineAt: new Date(row.hard_deadline_at).toISOString(),
    totalExtensionHours: row.total_extension_hours,
    releasedAt: iso(row.released_at),
    releaseReason: internal ? row.release_reason : null,
  };
  if (internal) {
    const lines = await db.query<ReservationLineRow>(
      `SELECT line_number, sku_id, product_code, sku_code, warehouse_id,
              warehouse_code, quantity, unit_price_cents, line_total_cents
       FROM order_reservation_lines WHERE reservation_id = $1
       ORDER BY line_number, warehouse_code`,
      [row.id]
    );
    dto.lines = lines.rows.map(line => ({
      lineNumber: line.line_number,
      skuId: line.sku_id,
      productCode: line.product_code,
      skuCode: line.sku_code,
      warehouseId: line.warehouse_id,
      warehouseCode: line.warehouse_code,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      lineTotalCents: Number(line.line_total_cents),
    }));
  }
  return dto;
}

interface FinalLineRow extends PlanLineRow {
  base_unit_price_cents: number;
}

async function buildFinalLines(db: Queryable, orderId: string): Promise<FinalLineDto[]> {
  const result = await db.query<FinalLineRow>(
    `SELECT line_number, sku_id, product_id, product_code, product_title,
            product_title_en, sku_code, color_name, color_name_en, color_hex,
            quantity, reference_unit_price_cents, unit_price_cents,
            line_total_cents, price_changed,
            reference_unit_price_cents AS base_unit_price_cents
     FROM order_final_lines WHERE order_id = $1 ORDER BY line_number`,
    [orderId]
  );
  return result.rows.map(row => ({
    ...planLineDto(row),
    baseReferenceUnitPriceCents: row.base_unit_price_cents,
  }));
}

async function planHistory(db: Queryable, orderId: string) {
  const result = await db.query<{
    plan_version: number;
    status: string;
    total_cents: string;
    created_at: Date;
  }>(
    `SELECT plan_version, status, total_cents, created_at
     FROM order_plans WHERE order_id = $1 ORDER BY plan_version`,
    [orderId]
  );
  return result.rows.map(row => ({
    version: row.plan_version,
    status: row.status,
    totalCents: Number(row.total_cents),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function buyerAuthorized(
  db: Queryable,
  companyId: string,
  customerUserId: string | null
): Promise<boolean> {
  if (!customerUserId) return false;
  const result = await db.query(
    `SELECT 1 FROM buyer_confirmation_authorizations
     WHERE company_id = $1 AND customer_user_id = $2 AND status = 'active'`,
    [companyId, customerUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function buildConfirmations(
  db: Queryable,
  row: OrderRow,
  internal: boolean
) {
  if (!row.confirmed_at) return null;
  const confirmation = await db.query<{
    confirmed_at: Date;
    total_cents: string;
    confirmed_by_label: string;
  }>(
    'SELECT confirmed_at, total_cents, confirmed_by_label FROM order_confirmations WHERE order_id = $1',
    [row.id]
  );
  const confirmationRow = confirmation.rows[0];
  return {
    confirmedAt: new Date(confirmationRow?.confirmed_at ?? row.confirmed_at).toISOString(),
    finalTotalCents: Number(confirmationRow?.total_cents ?? row.final_total_cents ?? 0),
    finalLines: await buildFinalLines(db, row.id),
    reservation: await buildReservation(db, row.id, internal),
    ...(internal ? { confirmedByLabel: confirmationRow?.confirmed_by_label ?? '' } : {}),
  };
}

function customerHistory(history: HistoryRow[]): CustomerOrderHistoryDto[] {
  return history.map(event => {
    const label = CUSTOMER_EVENT_LABELS[event.event_type] ?? event.event_type;
    const reason = CUSTOMER_VISIBLE_REASON_EVENTS.has(event.event_type) ? event.reason : '';
    return {
      eventType: event.event_type,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      reason: label + (reason ? ` — ${reason}` : ''),
      createdAt: new Date(event.created_at).toISOString(),
    };
  });
}

function internalHistory(history: HistoryRow[]): InternalOrderHistoryDto[] {
  return history.map(event => ({
    eventType: event.event_type,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    reason: event.reason,
    createdAt: new Date(event.created_at).toISOString(),
    actorType: event.actor_type,
    actorLabel: event.actor_label,
    details: event.details,
  }));
}

async function pendingRequest(
  db: Queryable,
  table: 'order_extension_requests' | 'order_release_requests',
  orderId: string
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM ${table} WHERE order_id = $1 AND status = 'PENDING' LIMIT 1`,
    [orderId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function buildCustomerOrder(
  db: Queryable,
  row: OrderRow,
  viewerCustomerUserId: string | null = null
): Promise<CustomerOrderDto> {
  const lines = await loadLines(db, row.id);
  const history = await loadHistory(db, row.id);
  const plan = (await buildPlan(db, row, false)) as CustomerPlanDto | null;
  const authorized = await buyerAuthorized(db, row.company_id, viewerCustomerUserId);
  const acceptance = plan?.acceptance ?? null;
  if (plan) {
    plan.canAccept =
      authorized &&
      row.status === 'PENDING_CONFIRMATION' &&
      plan.status === 'SUBMITTED' &&
      plan.acceptanceReady &&
      !acceptance;
    plan.canReject =
      authorized &&
      row.status === 'PENDING_CONFIRMATION' &&
      plan.status === 'SUBMITTED' &&
      !acceptance;
  }
  const confirmation = await buildConfirmations(db, row, false);
  return {
    id: row.id,
    orderNo: row.order_no,
    status: row.status,
    statusLabel: row.status_label,
    revision: Number(row.revision),
    lines: lines.map(orderLineDto),
    referenceTotalCents: Number(row.reference_total_cents),
    finalTotalCents: row.final_total_cents === null ? null : Number(row.final_total_cents),
    pricingMode: row.pricing_mode,
    pricingVersion: row.pricing_version,
    isReferenceQuote: row.is_reference_quote,
    priceNote: REFERENCE_PRICE_NOTE,
    shippingMethod: row.shipping_method,
    destinationCountryAlpha3: row.destination_country_alpha3.trim(),
    expectedShipDate: row.expected_ship_date_text,
    shippingRequirements: row.shipping_requirements,
    customerVisibleNote: row.customer_visible_note,
    submittedAt: new Date(row.submitted_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    cancelledAt: iso(row.cancelled_at),
    cancelReason: row.cancel_reason,
    cancellationKind: row.cancellation_kind,
    currentPlan: plan,
    planHistory: await planHistory(db, row.id),
    acceptance,
    canAcceptPlan: plan?.canAccept ?? false,
    canRejectPlan: plan?.canReject ?? false,
    buyerAuthorized: authorized,
    confirmation,
    history: customerHistory(history),
  };
}

export async function buildInternalOrder(
  db: Queryable,
  row: OrderRow
): Promise<InternalOrderDto> {
  const customer = await buildCustomerOrder(db, row, null);
  const history = await loadHistory(db, row.id);
  const plan = (await buildPlan(db, row, true)) as InternalPlanDto | null;
  const confirmation = await buildConfirmations(db, row, true);
  return {
    ...customer,
    currentPlan: plan,
    confirmation: confirmation as InternalOrderDto['confirmation'],
    company: {
      id: row.company_id,
      customerCode: row.company_code,
      shortName: row.company_name,
    },
    submittedByUsername: row.submitted_by_username,
    assignedSalesUserId: row.assigned_sales_user_id,
    currentAssignedSalesUserId: row.current_assigned_sales_user_id,
    pendingPriceApproval: plan?.priceApprovalStatus === 'PENDING',
    pendingExtensionRequest: await pendingRequest(db, 'order_extension_requests', row.id),
    pendingReleaseRequest: await pendingRequest(db, 'order_release_requests', row.id),
    history: internalHistory(history),
  };
}
