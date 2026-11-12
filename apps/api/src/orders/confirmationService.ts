import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import {
  buildInternalOrder,
  orderRow,
  type InternalOrderDto,
  type OrderRow,
} from './dto.js';
import { lockOrderForConfirmation } from './access.js';
import { queueOrderNotifications } from './notifications.js';
import {
  actionPayloadDigest,
  planDigest,
  requireIdempotencyKey,
  requirePlanVersion,
} from './planValidation.js';
import { replayIdempotentResult, storeIdempotentResult } from './idempotency.js';
import {
  HARD_RESERVATION_HOURS,
  INITIAL_RESERVATION_HOURS,
  MAX_ORDER_QUANTITY,
  SKU_MOQ,
  isUuid,
  multiplyCents,
  requireUuid,
} from './validation.js';

interface PlanRow {
  id: string;
  order_id: string;
  plan_version: number;
  status: string;
  plan_digest: string;
  price_fingerprint: string;
  price_epoch: string;
  requires_price_approval: boolean;
  quantity_total: number;
  total_cents: string;
}

interface PlanLineRow {
  id: string;
  line_number: number;
  order_item_id: string;
  sku_id: string;
  product_id: string;
  brand_id: string;
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

interface AcceptanceRow {
  id: string;
  order_id: string;
  plan_id: string;
  plan_version: number;
  plan_digest: string;
  company_id: string;
  customer_user_id: string;
  authorization_id: string;
  authorization_version: string;
  outcome: 'ACCEPTED' | 'REJECTED';
  invalidated_at: Date | null;
}

interface AuthorizationRow {
  id: string;
  company_id: string;
  customer_user_id: string;
  status: 'active' | 'revoked';
  version: string;
}

interface Allocation {
  skuId: string;
  warehouseId: string;
  quantity: number;
}

export interface ConfirmOrderInput {
  expectedRevision: unknown;
  expectedPlanVersion: unknown;
  planDigest: unknown;
  acceptanceId: unknown;
  allocations: unknown;
  idempotencyKey: unknown;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, 'invalid_request', 'expectedRevision must be a positive whole number.');
  }
  return value;
}

function normalizeAllocations(input: unknown): Allocation[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new HttpError(
      400,
      'invalid_allocations',
      'Provide at least one SKU+warehouse allocation.'
    );
  }
  if (input.length > 500) {
    throw new HttpError(400, 'invalid_allocations', 'At most 500 allocations are supported.');
  }
  const seen = new Set<string>();
  const result: Allocation[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      throw new HttpError(400, 'invalid_allocations', 'Each allocation must be an object.');
    }
    const item = raw as { skuId?: unknown; warehouseId?: unknown; quantity?: unknown };
    if (!isUuid(item.skuId)) {
      throw new HttpError(400, 'invalid_allocations', 'Each allocation must include a UUID skuId.');
    }
    if (!isUuid(item.warehouseId)) {
      throw new HttpError(
        400,
        'invalid_allocations',
        'Each allocation must include a UUID warehouseId.'
      );
    }
    if (
      typeof item.quantity !== 'number' ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_ORDER_QUANTITY
    ) {
      throw new HttpError(
        400,
        'invalid_allocations',
        'Allocation quantities must be positive whole numbers within the order range.'
      );
    }
    const skuId = item.skuId.trim();
    const warehouseId = item.warehouseId.trim();
    const pair = `${skuId}:${warehouseId}`;
    if (seen.has(pair)) {
      throw new HttpError(
        400,
        'duplicate_allocation',
        'Each SKU+warehouse pair may appear at most once.'
      );
    }
    seen.add(pair);
    result.push({ skuId, warehouseId, quantity: item.quantity });
  }
  return result;
}

function allocationDigest(allocations: Allocation[]): unknown {
  return [...allocations]
    .sort((left, right) =>
      left.skuId === right.skuId
        ? left.warehouseId.localeCompare(right.warehouseId)
        : left.skuId.localeCompare(right.skuId)
    )
    .map(item => ({
      skuId: item.skuId,
      warehouseId: item.warehouseId,
      quantity: item.quantity,
    }));
}

async function loadPlanLines(client: PoolClient, planId: string): Promise<PlanLineRow[]> {
  // order_plan_lines is immutable and the runtime role has SELECT/INSERT only.
  // A row lock would require UPDATE privilege and break least privilege. The
  // parent order/plan are already serialized by the caller.
  const result = await client.query<PlanLineRow>(
    'SELECT * FROM order_plan_lines WHERE plan_id = $1 ORDER BY line_number',
    [planId]
  );
  return result.rows;
}

async function assertLinesEligible(
  client: PoolClient,
  companyId: string,
  lines: PlanLineRow[]
): Promise<void> {
  const result = await client.query<{
    id: string;
    sku_code: string;
    sellable_status: string;
    published: boolean;
    brand_granted: boolean;
  }>(
    `SELECT s.id, s.sku_code, s.sellable_status, p.published,
            EXISTS (
              SELECT 1 FROM brand_grants g
              WHERE g.company_id = $2 AND g.brand_id = p.brand_id
            ) AS brand_granted
     FROM product_skus s
     JOIN products p ON p.id = s.product_id
     WHERE s.id = ANY($1::uuid[])
     ORDER BY s.id`,
    [lines.map(line => line.sku_id), companyId]
  );
  const states = new Map(result.rows.map(row => [row.id, row]));
  for (const line of lines) {
    const state = states.get(line.sku_id);
    if (!state) {
      throw new HttpError(
        422,
        'sku_unavailable',
        `SKU ${line.sku_code} is no longer available.`
      );
    }
    if (!state.published) {
      throw new HttpError(422, 'product_unavailable', `Product for ${line.sku_code} is no longer published.`);
    }
    if (state.sellable_status !== 'active') {
      throw new HttpError(422, 'sku_unavailable', `SKU ${line.sku_code} is discontinued.`);
    }
    if (!state.brand_granted) {
      throw new HttpError(
        422,
        'brand_not_authorized',
        `Your company is no longer authorized for the brand of ${line.sku_code}.`
      );
    }
    if (line.quantity < SKU_MOQ || line.quantity > MAX_ORDER_QUANTITY) {
      throw new HttpError(422, 'invalid_quantity', `SKU ${line.sku_code} has an invalid quantity.`);
    }
  }
}

export async function confirmOrder(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  input: ConfirmOrderInput
): Promise<InternalOrderDto> {
  const expectedRevision = revision(input.expectedRevision);
  const expectedPlanVersion = requirePlanVersion(input.expectedPlanVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  if (typeof input.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.planDigest)) {
    throw new HttpError(400, 'invalid_request', 'planDigest is required.');
  }
  const planDigestValue = input.planDigest;
  if (typeof input.acceptanceId !== 'string' || !input.acceptanceId.trim()) {
    throw new HttpError(400, 'invalid_request', 'acceptanceId is required.');
  }
  const acceptanceId = requireUuid(input.acceptanceId.trim(), 'acceptanceId');
  const allocations = normalizeAllocations(input.allocations);
  const digest = actionPayloadDigest('CONFIRM_ORDER', {
    orderId,
    expectedRevision,
    expectedPlanVersion,
    planDigest: planDigestValue,
    acceptanceId,
    allocations: allocationDigest(allocations),
  });

  return withTransaction(pool, async client => {
    const { order, companyId } = await lockOrderForConfirmation(
      client,
      auth,
      orderId,
      expectedPlanVersion
    );
    const scope = {
      operation: 'CONFIRM_ORDER',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId,
      companyId,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<InternalOrderDto>(client, scope);
    if (replayed) return replayed;

    if (order.status !== 'PENDING_CONFIRMATION') {
      throw new HttpError(
        409,
        'order_status_conflict',
        'Only an order pending confirmation can be confirmed.'
      );
    }
    if (Number(order.revision) !== expectedRevision) {
      throw new HttpError(
        409,
        'order_version_conflict',
        'The order changed in another session. Reload and retry.',
        undefined,
        { order: await buildInternalOrder(client, order) }
      );
    }
    if (order.current_plan_version !== expectedPlanVersion) {
      throw new HttpError(
        409,
        'plan_version_conflict',
        'A newer plan version exists. Reload and retry.',
        undefined,
        { order: await buildInternalOrder(client, order) }
      );
    }

    const planResult = await client.query<PlanRow>(
      'SELECT * FROM order_plans WHERE order_id = $1 AND plan_version = $2 FOR UPDATE',
      [orderId, expectedPlanVersion]
    );
    const plan = planResult.rows[0];
    if (!plan) throw new HttpError(409, 'plan_not_acceptable', 'The current plan is missing.');
    if (plan.status !== 'ACCEPTED') {
      throw new HttpError(
        409,
        'plan_not_accepted',
        'The current plan has not been accepted by the buyer confirmer.'
      );
    }
    const lines = await loadPlanLines(client, plan.id);
    const recomputed = planDigest(
      orderId,
      plan.plan_version,
      lines.map(line => ({
        lineNumber: line.line_number,
        skuId: line.sku_id,
        quantity: line.quantity,
        referenceUnitPriceCents: line.reference_unit_price_cents,
        unitPriceCents: line.unit_price_cents,
        lineTotalCents: Number(line.line_total_cents),
      }))
    );
    if (recomputed !== plan.plan_digest || planDigestValue !== plan.plan_digest) {
      throw new HttpError(
        409,
        'plan_digest_conflict',
        'The plan changed. Reload and review the accepted plan again.'
      );
    }

    const acceptanceResult = await client.query<AcceptanceRow>(
      `SELECT * FROM order_plan_acceptances
       WHERE id = $1 AND order_id = $2 FOR SHARE`,
      [acceptanceId, orderId]
    );
    const acceptance = acceptanceResult.rows[0];
    if (
      !acceptance ||
      acceptance.outcome !== 'ACCEPTED' ||
      acceptance.invalidated_at !== null ||
      acceptance.plan_id !== plan.id ||
      acceptance.plan_version !== plan.plan_version ||
      acceptance.plan_digest !== plan.plan_digest
    ) {
      throw new HttpError(
        409,
        'acceptance_invalid',
        'The plan acceptance is missing, stale or invalidated. The current authorized account must accept again.'
      );
    }
    if (acceptance.company_id !== companyId) {
      throw new HttpError(409, 'acceptance_invalid', 'The acceptance does not belong to this company.');
    }

    const authorizationResult = await client.query<AuthorizationRow>(
      'SELECT * FROM buyer_confirmation_authorizations WHERE id = $1 FOR UPDATE',
      [acceptance.authorization_id]
    );
    const authorization = authorizationResult.rows[0];
    if (
      !authorization ||
      authorization.status !== 'active' ||
      authorization.company_id !== companyId ||
      authorization.customer_user_id !== acceptance.customer_user_id ||
      Number(authorization.version) !== Number(acceptance.authorization_version)
    ) {
      throw new HttpError(
        403,
        'buyer_authorization_revoked',
        'The buyer confirmation authorization was revoked or replaced. The current authorized account must accept again.'
      );
    }
    const customer = await client.query<{ status: string; company_id: string }>(
      'SELECT status, company_id FROM customer_users WHERE id = $1 FOR SHARE',
      [acceptance.customer_user_id]
    );
    if (
      !customer.rows[0] ||
      customer.rows[0].status !== 'active' ||
      customer.rows[0].company_id !== companyId
    ) {
      throw new HttpError(
        403,
        'account_inactive',
        'The buyer confirmation account is no longer active.'
      );
    }

    if (plan.requires_price_approval) {
      const approval = await client.query(
        `SELECT 1 FROM order_price_approvals
         WHERE order_id = $1 AND price_fingerprint = $2 AND price_epoch = $3
           AND status = 'APPROVED'`,
        [orderId, plan.price_fingerprint, plan.price_epoch]
      );
      if (!approval.rowCount) {
        throw new HttpError(
          409,
          'price_approval_required',
          'The changed price on this plan has not been approved.'
        );
      }
    }

    await assertLinesEligible(client, companyId, lines);

    const planBySku = new Map(lines.map(line => [line.sku_id, line]));
    const sumBySku = new Map<string, number>();
    for (const allocation of allocations) {
      const line = planBySku.get(allocation.skuId);
      if (!line) {
        throw new HttpError(
          422,
          'unknown_allocation_sku',
          'The allocation contains a SKU that is not part of the accepted plan.'
        );
      }
      sumBySku.set(
        allocation.skuId,
        (sumBySku.get(allocation.skuId) ?? 0) + allocation.quantity
      );
    }
    for (const line of lines) {
      const allocated = sumBySku.get(line.sku_id) ?? 0;
      if (allocated === 0) {
        throw new HttpError(
          400,
          'allocation_missing',
          `Allocate every line: ${line.sku_code} has no warehouse allocation.`
        );
      }
      if (allocated !== line.quantity) {
        throw new HttpError(
          400,
          'allocation_quantity_mismatch',
          `Warehouse allocations for ${line.sku_code} sum to ${allocated}, expected ${line.quantity}.`
        );
      }
    }
    if (sumBySku.size !== lines.length) {
      throw new HttpError(422, 'unknown_allocation_sku', 'The allocation contains an extra SKU.');
    }

    const warehouseIds = [...new Set(allocations.map(item => item.warehouseId))].sort();
    const warehouses = await client.query<{ id: string; code: string; active: boolean }>(
      `SELECT id, code, active FROM warehouses
       WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE`,
      [warehouseIds]
    );
    const warehouseById = new Map(warehouses.rows.map(row => [row.id, row]));
    for (const warehouseId of warehouseIds) {
      const warehouse = warehouseById.get(warehouseId);
      if (!warehouse) {
        throw new HttpError(422, 'unknown_warehouse', 'A selected warehouse does not exist.');
      }
      if (!warehouse.active) {
        throw new HttpError(422, 'inactive_warehouse', `Warehouse ${warehouse.code} is inactive.`);
      }
    }

    // Deterministic SKU+warehouse lock order matches inventory import/adjust.
    const skuIds = [...new Set(allocations.map(item => item.skuId))].sort();
    const balances = await client.query<{
      sku_id: string;
      warehouse_id: string;
      on_hand: number;
      reserved: number;
      unsellable: number;
      version: string;
    }>(
      `SELECT sku_id, warehouse_id, on_hand, reserved, unsellable, version
       FROM inventory_balances
       WHERE sku_id = ANY($1::uuid[]) AND warehouse_id = ANY($2::uuid[])
       ORDER BY sku_id, warehouse_id
       FOR UPDATE`,
      [skuIds, warehouseIds]
    );
    const balanceByPair = new Map(
      balances.rows.map(row => [`${row.sku_id}:${row.warehouse_id}`, row])
    );
    for (const allocation of allocations) {
      const balance = balanceByPair.get(`${allocation.skuId}:${allocation.warehouseId}`);
      const line = planBySku.get(allocation.skuId)!;
      if (!balance) {
        throw new HttpError(
          409,
          'insufficient_stock',
          `No inventory row exists for ${line.sku_code} at the selected warehouse.`,
          undefined,
          {
            skuCode: line.sku_code,
            warehouseCode: warehouseById.get(allocation.warehouseId)?.code,
            available: 0,
            requested: allocation.quantity,
          }
        );
      }
      const available = balance.on_hand - balance.reserved - balance.unsellable;
      if (available < allocation.quantity) {
        throw new HttpError(
          409,
          'insufficient_stock',
          `SKU ${line.sku_code} only has ${available} PCS sellable at warehouse ${warehouseById.get(allocation.warehouseId)?.code}; ${allocation.quantity} requested.`,
          undefined,
          {
            skuCode: line.sku_code,
            warehouseCode: warehouseById.get(allocation.warehouseId)?.code,
            available,
            requested: allocation.quantity,
          }
        );
      }
    }

    const confirmationNow = await client.query<{ now: Date }>(
      'SELECT clock_timestamp() AS now'
    );
    const confirmedAt = new Date(confirmationNow.rows[0].now);
    const reservationId = randomUUID();
    const reservation = await client.query<{
      id: string;
      confirmed_at: Date;
      expires_at: Date;
      hard_deadline_at: Date;
    }>(
      `INSERT INTO order_reservations
        (id, order_id, company_id, status, reservation_version, confirmed_at,
         expires_at, hard_deadline_at, total_extension_hours)
       VALUES ($1, $2, $3, 'ACTIVE', 1, $4::timestamptz,
               $4::timestamptz + ($5::int * interval '1 hour'),
               $4::timestamptz + ($6::int * interval '1 hour'), 0)
       RETURNING id, confirmed_at, expires_at, hard_deadline_at`,
      [
        reservationId,
        orderId,
        companyId,
        confirmedAt,
        INITIAL_RESERVATION_HOURS,
        HARD_RESERVATION_HOURS,
      ]
    );
    const reservationRow = reservation.rows[0];

    for (const allocation of allocations) {
      const line = planBySku.get(allocation.skuId)!;
      const warehouse = warehouseById.get(allocation.warehouseId)!;
      const lineTotalCents = multiplyCents(line.unit_price_cents, allocation.quantity);
      await client.query(
        `INSERT INTO order_reservation_lines
          (id, reservation_id, order_id, plan_line_id, line_number, sku_id,
           product_code, sku_code, warehouse_id, warehouse_code, quantity,
           unit_price_cents, line_total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          randomUUID(),
          reservationId,
          orderId,
          line.id,
          line.line_number,
          line.sku_id,
          line.product_code,
          line.sku_code,
          allocation.warehouseId,
          warehouse.code,
          allocation.quantity,
          line.unit_price_cents,
          lineTotalCents,
        ]
      );

      const balance = balanceByPair.get(`${allocation.skuId}:${allocation.warehouseId}`)!;
      let applied: {
        reserved_before: number;
        reserved_after: number;
        version_after: string;
      };
      try {
        const result = await client.query<{
          reserved_before: number;
          reserved_after: number;
          version_after: string;
        }>(
          `SELECT reserved_before, reserved_after, version_after
           FROM aoking_reserve_inventory($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            reservationId,
            orderId,
            allocation.skuId,
            allocation.warehouseId,
            allocation.quantity,
            1,
            balance.version,
            balance.reserved,
            auth.user.id,
          ]
        );
        applied = result.rows[0];
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('insufficient_stock')) {
          throw new HttpError(
            409,
            'insufficient_stock',
            'Stock changed while the reservation was being applied. Reload and retry.'
          );
        }
        if (
          message.includes('inventory_conflict') ||
          message.includes('reservation_version_conflict')
        ) {
          throw new HttpError(
            409,
            'inventory_conflict',
            'Inventory or reservation changed during confirmation. Reload and retry.'
          );
        }
        if (message.includes('reservation_line_mismatch')) {
          throw new HttpError(
            409,
            'reservation_inconsistent',
            'The reservation line does not match the accepted allocation.'
          );
        }
        if (message.includes('reservation_already_applied')) {
          throw new HttpError(
            409,
            'reservation_already_applied',
            'This reservation line was already applied.'
          );
        }
        throw new HttpError(
          409,
          'reservation_conflict',
          'The reservation could not be applied. Reload and retry.'
        );
      }
      await client.query(
        `INSERT INTO inventory_movements
          (id, sku_id, warehouse_id, movement_type, delta_on_hand, delta_unsellable,
           on_hand_before, on_hand_after, unsellable_before, unsellable_after,
           reserved_before, reserved_after, reason, actor_type, actor_id, actor_label)
         VALUES ($1, $2, $3, 'reserve', 0, 0, $4, $4, $5, $5, $6, $7, $8,
                 'internal', $9, $10)`,
        [
          randomUUID(),
          allocation.skuId,
          allocation.warehouseId,
          balance.on_hand,
          balance.unsellable,
          applied.reserved_before,
          applied.reserved_after,
          `Order ${order.order_no} confirmed reservation`,
          auth.user.id,
          auth.user.username,
        ]
      );
    }

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_final_lines
          (id, order_id, line_number, sku_id, product_id, brand_id, product_code,
           product_title, product_title_en, sku_code, color_name, color_name_en,
           color_hex, quantity, reference_unit_price_cents, unit_price_cents,
           line_total_cents, price_changed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18)`,
        [
          randomUUID(),
          orderId,
          line.line_number,
          line.sku_id,
          line.product_id,
          line.brand_id,
          line.product_code,
          line.product_title,
          line.product_title_en,
          line.sku_code,
          line.color_name,
          line.color_name_en,
          line.color_hex,
          line.quantity,
          line.reference_unit_price_cents,
          line.unit_price_cents,
          Number(line.line_total_cents),
          line.price_changed,
        ]
      );
    }

    await client.query(
      `INSERT INTO order_confirmations
        (id, order_id, plan_id, plan_version, plan_digest, acceptance_id,
         reservation_id, confirmed_by_user_id, confirmed_by_label, confirmed_at,
         total_cents, quantity_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12)`,
      [
        randomUUID(),
        orderId,
        plan.id,
        plan.plan_version,
        plan.plan_digest,
        acceptance.id,
        reservationId,
        auth.user.id,
        auth.user.username,
        reservationRow.confirmed_at,
        Number(plan.total_cents),
        plan.quantity_total,
      ]
    );

    const expiresText = new Date(reservationRow.expires_at).toISOString();
    await client.query(
      `UPDATE orders
       SET status = 'CONFIRMED', confirmed_at = $2, first_confirmed_at = $2,
           confirmed_by_user_id = $3, final_total_cents = $4,
           final_plan_id = $5, final_plan_version = $6,
           revision = revision + 1, updated_at = now(),
           customer_visible_note = $7
       WHERE id = $1`,
      [
        orderId,
        reservationRow.confirmed_at,
        auth.user.id,
        Number(plan.total_cents),
        plan.id,
        plan.plan_version,
        `Order confirmed. Stock is reserved until ${expiresText}.`,
      ]
    );
    await client.query(
      `UPDATE order_plans SET status = 'CONFIRMED', decided_at = clock_timestamp() WHERE id = $1`,
      [plan.id]
    );
    await client.query(
      `INSERT INTO order_status_history
        (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
         actor_label, reason, details)
       VALUES ($1, $2, 'CONFIRMED', 'PENDING_CONFIRMATION', 'CONFIRMED',
               'internal', $3, $4, '', $5)`,
      [
        randomUUID(),
        orderId,
        auth.user.id,
        auth.user.username,
        {
          planVersion: plan.plan_version,
          planDigest: plan.plan_digest,
          acceptanceId: acceptance.id,
          reservationId,
          expiresAt: expiresText,
          hardDeadlineAt: new Date(reservationRow.hard_deadline_at).toISOString(),
          totalCents: Number(plan.total_cents),
          allocations: allocations.length,
        },
      ]
    );
    await queueOrderNotifications(client, {
      orderId,
      companyId,
      companyCode: order.company_code,
      orderNo: order.order_no,
      eventType: 'ORDER_CONFIRMED',
      customerMessage: `Order ${order.order_no} was confirmed and stock was reserved until ${expiresText}.`,
      salesMessage: `Order ${order.order_no} was confirmed. Reservation expires at ${expiresText}.`,
    });
    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: 'CONFIRM_ORDER',
      targetType: 'order',
      targetId: orderId,
      details: {
        orderNo: order.order_no,
        planVersion: plan.plan_version,
        planDigest: plan.plan_digest,
        acceptanceId: acceptance.id,
        reservationId,
        expiresAt: expiresText,
        totalCents: Number(plan.total_cents),
      },
    });

    const fresh = await orderRow(client, 'WHERE o.id = $1', [orderId]);
    if (!fresh) throw new HttpError(500, 'order_load_failed', 'The confirmed order could not be loaded.');
    const result = await buildInternalOrder(client, fresh);
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

export type { OrderRow };
