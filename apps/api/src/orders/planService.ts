import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import { requireCustomerCompany } from '../cart/service.js';
import {
  buildCustomerOrder,
  buildInternalOrder,
  ORDER_SELECT,
  type CustomerOrderDto,
  type InternalOrderDto,
  type InternalPlanDto,
  type OrderRow,
} from './dto.js';
import {
  assertCurrentSession,
  lockOrderForApproval,
  lockOrderForCurrentSalesWrite,
} from './access.js';
import {
  queueBusinessAdminNotifications,
  queueInternalNotification,
  queueOrderNotifications,
} from './notifications.js';
import {
  actionPayloadDigest,
  planDigest,
  priceFingerprint,
  requireIdempotencyKey,
  requirePlanVersion,
  validateUnitPrice,
} from './planValidation.js';
import { replayIdempotentResult, storeIdempotentResult } from './idempotency.js';
import {
  checkPrivacyViolations,
  multiplyCents,
  sumCents,
  validateOrderQuantity,
} from './validation.js';
import { requireActiveAuthorization } from './authorizationService.js';

interface InputPlanLine {
  skuId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface SavePlanInput {
  expectedRevision: unknown;
  expectedPlanVersion: unknown;
  idempotencyKey: unknown;
  lines: unknown;
}

export interface SavePlanResult {
  order: InternalOrderDto;
  plan: InternalPlanDto;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, 'invalid_request', 'expectedRevision must be a positive whole number.');
  }
  return value;
}

function normalizePlanLines(input: unknown): Map<string, InputPlanLine> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new HttpError(400, 'invalid_lines', 'Provide the complete plan with at least one line.');
  }
  if (input.length > 100) {
    throw new HttpError(400, 'invalid_lines', 'At most 100 plan lines are supported.');
  }
  const map = new Map<string, InputPlanLine>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      throw new HttpError(400, 'invalid_lines', 'Each plan line must be an object.');
    }
    const line = raw as { skuId?: unknown; quantity?: unknown; unitPriceCents?: unknown };
    if (typeof line.skuId !== 'string' || !line.skuId.trim()) {
      throw new HttpError(400, 'invalid_lines', 'Each plan line must include skuId.');
    }
    const skuId = line.skuId.trim();
    if (map.has(skuId)) {
      throw new HttpError(400, 'invalid_lines', `Duplicate SKU in the plan: ${skuId}`);
    }
    map.set(skuId, {
      skuId,
      quantity: validateOrderQuantity(line.quantity),
      unitPriceCents: validateUnitPrice(line.unitPriceCents),
    });
  }
  return map;
}

interface OrderItemPlanRow {
  id: string;
  line_number: number;
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
  quantity: number;
  reference_unit_price_cents: number;
  unit_price_cents: number;
  line_total_cents: string;
}

async function planRow(
  client: PoolClient,
  orderId: string,
  version: number,
  lock = false
): Promise<PlanRow | null> {
  const result = await client.query<PlanRow>(
    `SELECT * FROM order_plans WHERE order_id = $1 AND plan_version = $2
     ${lock ? 'FOR UPDATE' : ''}`,
    [orderId, version]
  );
  return result.rows[0] ?? null;
}

async function planLineRows(client: PoolClient, planId: string): Promise<PlanLineRow[]> {
  const result = await client.query<PlanLineRow>(
    `SELECT line_number, sku_id, quantity, reference_unit_price_cents,
            unit_price_cents, line_total_cents
     FROM order_plan_lines WHERE plan_id = $1 ORDER BY line_number`,
    [planId]
  );
  return result.rows;
}

async function currentPlan(client: PoolClient, order: OrderRow): Promise<PlanRow | null> {
  if (order.current_plan_version < 1) return null;
  return planRow(client, order.id, order.current_plan_version, true);
}

async function assertPlanEligibility(
  client: PoolClient,
  companyId: string,
  skuIds: string[]
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
    [skuIds, companyId]
  );
  const states = new Map(result.rows.map(row => [row.id, row]));
  for (const skuId of skuIds) {
    const state = states.get(skuId);
    if (!state) throw new HttpError(422, 'sku_unavailable', `SKU ${skuId} is no longer available.`);
    if (!state.published) {
      throw new HttpError(422, 'product_unavailable', 'A product in this order is no longer published.');
    }
    if (state.sellable_status !== 'active') {
      throw new HttpError(422, 'sku_unavailable', `SKU ${state.sku_code} is discontinued.`);
    }
    if (!state.brand_granted) {
      throw new HttpError(
        422,
        'brand_not_authorized',
        'Your company is no longer authorized for a brand in this order.'
      );
    }
  }
}

interface ExistingApprovalRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  requested_plan_version: number;
  price_fingerprint: string;
  price_epoch: string;
  requested_by_label: string;
  requested_at: Date;
  decided_by_label: string | null;
  decided_at: Date | null;
  decision_note: string | null;
}

async function approvalForPlan(
  client: PoolClient,
  orderId: string,
  fingerprint: string,
  epoch: number,
  lock = false
): Promise<ExistingApprovalRow | null> {
  const result = await client.query<ExistingApprovalRow>(
    `SELECT * FROM order_price_approvals
     WHERE order_id = $1 AND price_fingerprint = $2 AND price_epoch = $3
       AND status IN ('PENDING', 'APPROVED', 'REJECTED')
     ORDER BY CASE status WHEN 'APPROVED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,
              requested_at DESC
     LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [orderId, fingerprint, epoch]
  );
  return result.rows[0] ?? null;
}

function planPayloadDigest(input: {
  orderId: string;
  expectedRevision: number;
  expectedPlanVersion: number;
  lines: InputPlanLine[];
}): string {
  return actionPayloadDigest('SAVE_SALES_PLAN', {
    orderId: input.orderId,
    expectedRevision: input.expectedRevision,
    expectedPlanVersion: input.expectedPlanVersion,
    lines: [...input.lines]
      .sort((left, right) => left.skuId.localeCompare(right.skuId))
      .map(line => ({
        skuId: line.skuId,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
  });
}

export async function saveSalesPlan(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  input: SavePlanInput
): Promise<SavePlanResult> {
  const expectedRevision = revision(input.expectedRevision);
  const expectedPlanVersion = requirePlanVersion(input.expectedPlanVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  const requested = normalizePlanLines(input.lines);
  const requestedLines = [...requested.values()];
  const digest = planPayloadDigest({
    orderId,
    expectedRevision,
    expectedPlanVersion,
    lines: requestedLines,
  });

  return withTransaction(pool, async client => {
    const { order, companyId } = await lockOrderForCurrentSalesWrite(client, auth, orderId);
    const scope = {
      operation: 'SAVE_SALES_PLAN',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId,
      companyId,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<SavePlanResult>(client, scope);
    if (replayed) return replayed;

    if (order.status !== 'PENDING_CONFIRMATION') {
      throw new HttpError(
        409,
        'order_status_conflict',
        'Only an order pending confirmation can receive a new plan.'
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
        'A newer plan version already exists. Reload and base the next plan on it.',
        undefined,
        { order: await buildInternalOrder(client, order) }
      );
    }

    const items = await client.query<OrderItemPlanRow>(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_number FOR SHARE',
      [orderId]
    );
    if (items.rows.length !== requested.size) {
      throw new HttpError(
        422,
        'plan_line_mismatch',
        'The plan must contain every existing order line exactly once.'
      );
    }
    const itemBySku = new Map(items.rows.map(item => [item.sku_id, item]));
    for (const skuId of requested.keys()) {
      if (!itemBySku.has(skuId)) {
        throw new HttpError(
          422,
          'plan_line_mismatch',
          `SKU ${skuId} is not part of this order.`
        );
      }
    }
    await assertPlanEligibility(client, companyId, [...requested.keys()]);

    const computed = items.rows.map(item => {
      const line = requested.get(item.sku_id)!;
      const lineTotalCents = multiplyCents(line.unitPriceCents, line.quantity);
      return { item, line, lineTotalCents };
    });
    const totalCents = sumCents(computed.map(row => row.lineTotalCents));
    const quantityTotal = computed.reduce((sum, row) => sum + row.line.quantity, 0);
    const fingerprint = priceFingerprint(
      orderId,
      computed.map(row => ({
        skuId: row.item.sku_id,
        referenceUnitPriceCents: row.item.reference_unit_price_cents,
        unitPriceCents: row.line.unitPriceCents,
      }))
    );

    const previous = await currentPlan(client, order);
    let priceChangedFromPrevious = false;
    if (previous) {
      const previousLines = await client.query<{
        sku_id: string;
        unit_price_cents: number;
      }>(
        'SELECT sku_id, unit_price_cents FROM order_plan_lines WHERE plan_id = $1',
        [previous.id]
      );
      const previousBySku = new Map(
        previousLines.rows.map(row => [row.sku_id, row.unit_price_cents])
      );
      if (previousBySku.size !== computed.length) {
        priceChangedFromPrevious = true;
      } else {
        for (const row of computed) {
          if (previousBySku.get(row.item.sku_id) !== row.line.unitPriceCents) {
            priceChangedFromPrevious = true;
            break;
          }
        }
      }
    } else {
      // The first plan is exempt only when every line still equals the
      // submission reference price. Any first manual price is a change.
      priceChangedFromPrevious = computed.some(
        row => row.line.unitPriceCents !== row.item.reference_unit_price_cents
      );
    }

    // A quantity-only version inherits the current epoch's approval
    // requirement and status. A manual change in either direction creates a
    // new epoch, including a change back to the reference price or to a
    // previously approved number.
    const requiresPriceApproval = previous
      ? priceChangedFromPrevious || previous.requires_price_approval
      : priceChangedFromPrevious;
    let epoch = previous ? Number(previous.price_epoch) : Number(order.price_epoch);
    if (priceChangedFromPrevious) {
      epoch += 1;
      await client.query(
        `UPDATE order_price_approvals
         SET status = 'SUPERSEDED', decided_at = now(),
             decision_note = 'Superseded by a newer plan price state.'
         WHERE order_id = $1 AND status = 'PENDING'`,
        [orderId]
      );
    }

    const planVersion = order.current_plan_version + 1;
    const planId = randomUUID();
    const digestOfPlan = planDigest(
      orderId,
      planVersion,
      computed.map(row => ({
        lineNumber: row.item.line_number,
        skuId: row.item.sku_id,
        quantity: row.line.quantity,
        referenceUnitPriceCents: row.item.reference_unit_price_cents,
        unitPriceCents: row.line.unitPriceCents,
        lineTotalCents: row.lineTotalCents,
      }))
    );

    // Any new version, including a quantity-only change, invalidates the old
    // acceptance and requires the current authorized account to accept again.
    await client.query(
      `UPDATE order_plan_acceptances
       SET invalidated_at = now(), invalidation_reason = 'plan_changed'
       WHERE order_id = $1 AND invalidated_at IS NULL`,
      [orderId]
    );
    if (previous) {
      await client.query(
        `UPDATE order_plans SET status = 'SUPERSEDED', decided_at = now()
         WHERE id = $1`,
        [previous.id]
      );
    }

    await client.query(
      `INSERT INTO order_plans
        (id, order_id, plan_version, status, created_by_user_id, created_by_label,
         plan_digest, price_fingerprint, price_epoch, requires_price_approval,
         quantity_total, total_cents)
       VALUES ($1, $2, $3, 'SUBMITTED', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        planId,
        orderId,
        planVersion,
        auth.user.id,
        auth.user.username,
        digestOfPlan,
        fingerprint,
        epoch,
        requiresPriceApproval,
        quantityTotal,
        totalCents,
      ]
    );
    for (const row of computed) {
      await client.query(
        `INSERT INTO order_plan_lines
          (id, plan_id, line_number, order_item_id, sku_id, product_id, brand_id,
           product_code, product_title, product_title_en, sku_code, color_name,
           color_name_en, color_hex, quantity, reference_unit_price_cents,
           unit_price_cents, line_total_cents, price_changed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $19)`,
        [
          randomUUID(),
          planId,
          row.item.line_number,
          row.item.id,
          row.item.sku_id,
          row.item.product_id,
          row.item.brand_id,
          row.item.product_code,
          row.item.product_title,
          row.item.product_title_en,
          row.item.sku_code,
          row.item.color_name,
          row.item.color_name_en,
          row.item.color_hex,
          row.line.quantity,
          row.item.reference_unit_price_cents,
          row.line.unitPriceCents,
          row.lineTotalCents,
          row.line.unitPriceCents !== row.item.reference_unit_price_cents,
        ]
      );
    }

    let approval = await approvalForPlan(client, orderId, fingerprint, epoch, true);
    if (requiresPriceApproval && !approval) {
      const approvalId = randomUUID();
      await client.query(
        `INSERT INTO order_price_approvals
          (id, order_id, requested_plan_id, requested_plan_version,
           price_fingerprint, price_epoch, status, requested_by_user_id,
           requested_by_label, reason)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9)`,
        [
          approvalId,
          orderId,
          planId,
          planVersion,
          fingerprint,
          epoch,
          auth.user.id,
          auth.user.username,
          `Price change requested with plan v${planVersion}.`,
        ]
      );
      approval = await approvalForPlan(client, orderId, fingerprint, epoch, true);
    }
    if (!requiresPriceApproval) approval = null;
    if (requiresPriceApproval && approval?.status === 'REJECTED') {
      // A quantity-only resubmission inherits the rejected price state; it
      // cannot become acceptable until the salesperson changes the price into
      // a new epoch and that new change is approved.
      await client.query(
        `UPDATE order_plans SET status = 'REJECTED', decided_at = now() WHERE id = $1`,
        [planId]
      );
    }

    await client.query(
      `UPDATE orders
       SET current_plan_version = $2, price_epoch = $3, revision = revision + 1,
           updated_at = now()
       WHERE id = $1`,
      [orderId, planVersion, epoch]
    );

    await client.query(
      `INSERT INTO order_status_history
        (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
         actor_label, reason, details)
       VALUES ($1, $2, 'PLAN_SUBMITTED', 'PENDING_CONFIRMATION', 'PENDING_CONFIRMATION',
               'internal', $3, $4, '', $5)`,
      [
        randomUUID(),
        orderId,
        auth.user.id,
        auth.user.username,
        {
          planVersion,
          planDigest: digestOfPlan,
          priceFingerprint: fingerprint,
          priceEpoch: epoch,
          totalCents,
          requiresPriceApproval,
          priceChangedFromPrevious,
        },
      ]
    );

    if (requiresPriceApproval && approval?.status === 'PENDING') {
      await queueBusinessAdminNotifications(client, {
        orderId,
        companyId,
        orderNo: order.order_no,
        companyCode: order.company_code,
        eventType: 'PRICE_APPROVAL_REQUIRED',
        title: `Price approval · ${order.order_no}`,
        message: `Order ${order.order_no} has a changed-price plan v${planVersion} waiting for approval.`,
        permission: 'orders.approve_price',
      });
    } else if (requiresPriceApproval && approval?.status === 'REJECTED') {
      if (order.current_assigned_sales_user_id) {
        await queueInternalNotification(client, {
          orderId,
          companyId,
          orderNo: order.order_no,
          companyCode: order.company_code,
          eventType: 'PRICE_REJECTED',
          internalUserId: order.current_assigned_sales_user_id,
          title: `Price change still declined · ${order.order_no}`,
          message: `Plan v${planVersion} keeps the declined price state. Change the price to create a new approval request or restore the reference price through a new price change.`,
        });
      }
    } else {
      await queueOrderNotifications(client, {
        orderId,
        companyId,
        companyCode: order.company_code,
        orderNo: order.order_no,
        eventType: 'PLAN_READY',
        customerMessage: `A sales plan for order ${order.order_no} is ready for review.`,
        salesMessage: `Plan v${planVersion} for order ${order.order_no} is ready for buyer acceptance.`,
      });
    }

    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: 'SAVE_ORDER_PLAN',
      targetType: 'order',
      targetId: orderId,
      details: {
        orderNo: order.order_no,
        planVersion,
        planDigest: digestOfPlan,
        totalCents,
        requiresPriceApproval,
        priceChangedFromPrevious,
        priceEpoch: epoch,
      },
    });

    const updated = await buildInternalOrder(client, {
      ...order,
      current_plan_version: planVersion,
      price_epoch: String(epoch),
      revision: String(Number(order.revision) + 1),
    });
    const result: SavePlanResult = {
      order: updated,
      plan: updated.currentPlan!,
    };
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

export interface PlanDecisionInput {
  expectedRevision: unknown;
  expectedPlanVersion: unknown;
  planDigest: unknown;
  outcome: unknown;
  reason?: unknown;
  idempotencyKey: unknown;
}

export async function decidePlanAcceptance(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  input: PlanDecisionInput
): Promise<CustomerOrderDto> {
  const companyId = requireCustomerCompany(auth);
  const expectedRevision = revision(input.expectedRevision);
  const expectedPlanVersion = requirePlanVersion(input.expectedPlanVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  if (
    typeof input.planDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.planDigest)
  ) {
    throw new HttpError(400, 'invalid_request', 'planDigest is required.');
  }
  if (input.outcome !== 'ACCEPTED' && input.outcome !== 'REJECTED') {
    throw new HttpError(400, 'invalid_plan_decision', 'outcome must be ACCEPTED or REJECTED.');
  }
  const outcome = input.outcome;
  const reason =
    input.reason === undefined
      ? ''
      : typeof input.reason === 'string'
        ? input.reason.trim().slice(0, 1000)
        : (() => {
            throw new HttpError(400, 'invalid_request', 'reason must be text.');
          })();
  const privacy = checkPrivacyViolations(reason);
  if (privacy.hasViolation) {
    throw new HttpError(422, 'privacy_violation', privacy.message ?? 'Privacy check failed.');
  }
  const digest = actionPayloadDigest('DECIDE_ORDER_PLAN', {
    orderId,
    expectedRevision,
    expectedPlanVersion,
    planDigest: input.planDigest,
    outcome,
    reason,
  });

  return withTransaction(pool, async client => {
    const company = await client.query<{ company_status: string }>(
      `SELECT c.status AS company_status
       FROM customer_companies c WHERE c.id = $1 FOR UPDATE`,
      [companyId]
    );
    if (company.rows[0]?.company_status !== 'active') {
      throw new HttpError(403, 'account_inactive', 'The customer company is not active.');
    }
    await assertCurrentSession(client, auth);
    const user = await client.query<{ status: string }>(
      'SELECT status FROM customer_users WHERE id = $1 AND company_id = $2 FOR SHARE',
      [auth.user.id, companyId]
    );
    if (user.rows[0]?.status !== 'active') {
      throw new HttpError(403, 'account_inactive', 'The customer account is not active.');
    }

    const orderResult = await client.query<OrderRow>(
      `${ORDER_SELECT} WHERE o.id = $1 AND o.company_id = $2 FOR UPDATE OF o`,
      [orderId, companyId]
    );
    const order = orderResult.rows[0];
    if (!order) throw new HttpError(404, 'order_not_found', 'Order not found.');

    // The current active authorization instance is checked BEFORE replay, so a
    // revoked account cannot replay an old acceptance result. It is also bound
    // to the idempotency record: re-granting (a new instance) cannot revive it.
    const authorization = await requireActiveAuthorization(
      client,
      companyId,
      auth.user.id,
      true
    );

    const scope = {
      operation: 'DECIDE_ORDER_PLAN',
      actorType: 'customer' as const,
      actorId: auth.user.id,
      orderId,
      companyId,
      authorizationId: authorization.id,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<CustomerOrderDto>(client, scope);
    if (replayed) return replayed;

    if (order.status !== 'PENDING_CONFIRMATION') {
      throw new HttpError(409, 'order_status_conflict', 'This order is no longer pending confirmation.');
    }
    if (Number(order.revision) !== expectedRevision) {
      throw new HttpError(
        409,
        'order_version_conflict',
        'The order changed in another session. Reload and retry.',
        undefined,
        { order: await buildCustomerOrder(client, order, auth.user.id) }
      );
    }
    if (order.current_plan_version !== expectedPlanVersion) {
      throw new HttpError(
        409,
        'plan_version_conflict',
        'A newer plan version exists. Reload before deciding.',
        undefined,
        { order: await buildCustomerOrder(client, order, auth.user.id) }
      );
    }
    const plan = await planRow(client, orderId, expectedPlanVersion, true);
    if (!plan || plan.status !== 'SUBMITTED') {
      throw new HttpError(409, 'plan_not_acceptable', 'The current plan is not awaiting acceptance.');
    }
    const lines = await planLineRows(client, plan.id);
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
    if (recomputed !== plan.plan_digest || input.planDigest !== plan.plan_digest) {
      throw new HttpError(
        409,
        'plan_digest_conflict',
        'The plan changed. Reload and review the latest version.'
      );
    }

    if (plan.requires_price_approval) {
      const approval = await approvalForPlan(
        client,
        orderId,
        plan.price_fingerprint,
        Number(plan.price_epoch),
        true
      );
      if (!approval || approval.status === 'PENDING') {
        throw new HttpError(
          409,
          'price_approval_pending',
          'The price change on this plan is still awaiting business approval.'
        );
      }
      if (approval.status !== 'APPROVED') {
        throw new HttpError(
          409,
          'price_approval_rejected',
          'The price change on this plan was declined. Sales must submit a new plan.'
        );
      }
    }

    const accepted = await client.query(
      `SELECT 1 FROM order_plan_acceptances
       WHERE order_id = $1 AND outcome = 'ACCEPTED' AND invalidated_at IS NULL`,
      [orderId]
    );
    if (outcome === 'ACCEPTED' && accepted.rowCount) {
      throw new HttpError(409, 'already_accepted', 'This plan has already been accepted.');
    }

    await client.query(
      `INSERT INTO order_plan_acceptances
        (id, order_id, plan_id, plan_version, plan_digest, company_id,
         customer_user_id, customer_username, authorization_id,
         authorization_version, outcome, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        randomUUID(),
        orderId,
        plan.id,
        plan.plan_version,
        plan.plan_digest,
        companyId,
        auth.user.id,
        auth.user.username,
        authorization.id,
        Number(authorization.version),
        outcome,
        reason,
      ]
    );
    await client.query(
      `UPDATE order_plans SET status = $2, decided_at = now() WHERE id = $1`,
      [plan.id, outcome === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED']
    );
    await client.query(
      `INSERT INTO order_status_history
        (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
         actor_label, reason, details)
       VALUES ($1, $2, $3, 'PENDING_CONFIRMATION', 'PENDING_CONFIRMATION',
               'customer', $4, $5, $6, $7)`,
      [
        randomUUID(),
        orderId,
        outcome === 'ACCEPTED' ? 'PLAN_ACCEPTED' : 'PLAN_REJECTED',
        auth.user.id,
        auth.user.username,
        reason,
        {
          planVersion: plan.plan_version,
          planDigest: plan.plan_digest,
          authorizationId: authorization.id,
          outcome,
        },
      ]
    );
    await queueOrderNotifications(client, {
      orderId,
      companyId,
      companyCode: order.company_code,
      orderNo: order.order_no,
      eventType: outcome === 'ACCEPTED' ? 'PLAN_ACCEPTED' : 'PLAN_REJECTED',
      customerMessage:
        outcome === 'ACCEPTED'
          ? `Your company accepted plan v${plan.plan_version} for order ${order.order_no}.`
          : `Plan v${plan.plan_version} for order ${order.order_no} was returned to sales.`,
      salesMessage:
        outcome === 'ACCEPTED'
          ? `The buyer confirmer accepted plan v${plan.plan_version} for order ${order.order_no}.`
          : `The buyer confirmer rejected plan v${plan.plan_version} for order ${order.order_no}.`,
    });
    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: outcome === 'ACCEPTED' ? 'ACCEPT_ORDER_PLAN' : 'REJECT_ORDER_PLAN',
      targetType: 'order',
      targetId: orderId,
      details: {
        orderNo: order.order_no,
        planVersion: plan.plan_version,
        planDigest: plan.plan_digest,
        authorizationId: authorization.id,
        outcome,
      },
    });

    const result = await buildCustomerOrder(client, order, auth.user.id);
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

export interface PriceApprovalDecisionInput {
  decision: unknown;
  note?: unknown;
  expectedPlanVersion: unknown;
  idempotencyKey: unknown;
}

export interface PriceApprovalDecisionResult {
  order: InternalOrderDto;
  approval: {
    id: string;
    status: 'APPROVED' | 'REJECTED';
    decidedByLabel: string;
    decidedAt: string;
    decidedPlanVersion: number;
    decisionNote: string | null;
  };
}

export async function decidePriceApproval(
  pool: DbPool,
  auth: AuthContext,
  approvalId: string,
  input: PriceApprovalDecisionInput
): Promise<PriceApprovalDecisionResult> {
  if (auth.user.type !== 'internal' || !auth.user.permissions.includes('orders.approve_price')) {
    throw new HttpError(403, 'forbidden', 'The orders.approve_price permission is required.');
  }
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    throw new HttpError(400, 'invalid_decision', 'decision must be APPROVED or REJECTED.');
  }
  const decision = input.decision;
  const expectedPlanVersion = requirePlanVersion(input.expectedPlanVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  const note =
    input.note === undefined
      ? ''
      : typeof input.note === 'string'
        ? input.note.trim().slice(0, 1000)
        : (() => {
            throw new HttpError(400, 'invalid_request', 'note must be text.');
          })();
  const digest = actionPayloadDigest('DECIDE_PRICE_APPROVAL', {
    approvalId,
    decision,
    note,
    expectedPlanVersion,
  });

  return withTransaction(pool, async client => {
    const pointer = await client.query<{ order_id: string }>(
      'SELECT order_id FROM order_price_approvals WHERE id = $1',
      [approvalId]
    );
    if (!pointer.rows[0]) {
      throw new HttpError(404, 'approval_not_found', 'Price approval request not found.');
    }
    const order = await lockOrderForApproval(client, pointer.rows[0].order_id);
    await assertCurrentSession(client, auth, 'orders.approve_price');
    const scope = {
      operation: 'DECIDE_PRICE_APPROVAL',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId: order.id,
      companyId: order.company_id,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<PriceApprovalDecisionResult>(client, scope);
    if (replayed) return replayed;

    const approvalResult = await client.query<ExistingApprovalRow>(
      'SELECT * FROM order_price_approvals WHERE id = $1 FOR UPDATE',
      [approvalId]
    );
    const approval = approvalResult.rows[0];
    if (!approval) {
      throw new HttpError(404, 'approval_not_found', 'Price approval request not found.');
    }
    if (approval.status !== 'PENDING') {
      throw new HttpError(409, 'approval_already_decided', 'This price approval was already decided.');
    }
    if (order.status !== 'PENDING_CONFIRMATION') {
      throw new HttpError(409, 'order_status_conflict', 'This order is no longer pending confirmation.');
    }
    if (order.current_plan_version !== expectedPlanVersion) {
      throw new HttpError(
        409,
        'plan_version_conflict',
        'A newer plan version exists. Reject this stale request and review the latest plan.'
      );
    }
    const plan = await planRow(client, order.id, expectedPlanVersion, true);
    if (
      !plan ||
      plan.price_fingerprint !== approval.price_fingerprint ||
      Number(plan.price_epoch) !== Number(approval.price_epoch)
    ) {
      throw new HttpError(
        409,
        'approval_stale',
        'The plan price state changed after this request. The request is stale.'
      );
    }
    if (Number(order.price_epoch) !== Number(approval.price_epoch)) {
      throw new HttpError(409, 'approval_stale', 'The order price epoch changed.');
    }

    await client.query(
      `UPDATE order_price_approvals
       SET status = $2, decided_by_user_id = $3, decided_by_label = $4,
           decided_at = now(), decided_plan_version = $5, decision_note = $6
       WHERE id = $1`,
      [approvalId, decision, auth.user.id, auth.user.username, plan.plan_version, note]
    );

    if (decision === 'APPROVED') {
      await client.query(
        `INSERT INTO order_status_history
          (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
           actor_label, reason, details)
         VALUES ($1, $2, 'PRICE_APPROVED', 'PENDING_CONFIRMATION', 'PENDING_CONFIRMATION',
                 'internal', $3, $4, $5, $6)`,
        [
          randomUUID(),
          order.id,
          auth.user.id,
          auth.user.username,
          note,
          {
            approvalId,
            planVersion: plan.plan_version,
            priceFingerprint: approval.price_fingerprint,
            priceEpoch: Number(approval.price_epoch),
            requestedByLabel: approval.requested_by_label,
          },
        ]
      );
      await queueOrderNotifications(client, {
        orderId: order.id,
        companyId: order.company_id,
        companyCode: order.company_code,
        orderNo: order.order_no,
        eventType: 'PLAN_READY',
        customerMessage: `The price change for order ${order.order_no} was approved. Plan v${plan.plan_version} is ready for buyer acceptance.`,
        salesMessage: `Price change for ${order.order_no} approved; plan v${plan.plan_version} is ready for buyer acceptance.`,
      });
    } else {
      await client.query(
        `UPDATE order_plans SET status = 'REJECTED', decided_at = now() WHERE id = $1`,
        [plan.id]
      );
      await client.query(
        `INSERT INTO order_status_history
          (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
           actor_label, reason, details)
         VALUES ($1, $2, 'PRICE_REJECTED', 'PENDING_CONFIRMATION', 'PENDING_CONFIRMATION',
                 'internal', $3, $4, $5, $6)`,
        [
          randomUUID(),
          order.id,
          auth.user.id,
          auth.user.username,
          note,
          {
            approvalId,
            planVersion: plan.plan_version,
            priceFingerprint: approval.price_fingerprint,
            priceEpoch: Number(approval.price_epoch),
          },
        ]
      );
      await queueOrderNotifications(client, {
        orderId: order.id,
        companyId: order.company_id,
        companyCode: order.company_code,
        orderNo: order.order_no,
        eventType: 'PRICE_REJECTED',
        customerMessage: `The price change for order ${order.order_no} was declined. Sales will submit a revised plan.`,
        salesMessage: `Price change for ${order.order_no} declined. Submit a new plan or restore the reference price.`,
      });
    }

    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: decision === 'APPROVED' ? 'APPROVE_PRICE_CHANGE' : 'REJECT_PRICE_CHANGE',
      targetType: 'order',
      targetId: order.id,
      details: {
        orderNo: order.order_no,
        approvalId,
        planVersion: plan.plan_version,
        requestedByLabel: approval.requested_by_label,
        decision,
        note,
      },
    });

    const updated = await buildInternalOrder(client, order);
    const result: PriceApprovalDecisionResult = {
      order: updated,
      approval: {
        id: approvalId,
        status: decision,
        decidedByLabel: auth.user.username,
        decidedAt: new Date().toISOString(),
        decidedPlanVersion: plan.plan_version,
        decisionNote: note || null,
      },
    };
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}
