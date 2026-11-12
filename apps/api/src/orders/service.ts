import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { writeAudit } from '../audit/audit.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/types.js';
import { getCartForCompany, requireCustomerCompany } from '../cart/service.js';
import { queueOrderNotifications } from './notifications.js';
import {
  PRICING_MODE,
  PRICING_VERSION,
  SKU_MOQ,
  checkPrivacyViolations,
  formatOrderNumber,
  multiplyCents,
  orderBusinessDate,
  orderNumberDatePart,
  orderPayloadDigest,
  sumCents,
  validateDelivery,
  validateOrderQuantity,
  type Delivery,
} from './validation.js';
import {
  ORDER_SELECT,
  buildCustomerOrder,
  buildInternalOrder,
  loadLines,
  orderRow,
  type CustomerOrderDto,
  type InternalOrderDto,
  type OrderRow,
} from './dto.js';

export type {
  CustomerOrderDto,
  CustomerOrderHistoryDto,
  InternalOrderDto,
  InternalOrderHistoryDto,
  OrderLineDto,
} from './dto.js';

function actor(auth: AuthContext) {
  return {
    actorType: auth.user.type,
    actorId: auth.user.id,
    actorLabel: auth.user.username,
  };
}

function textValue(value: unknown, field: string, max: number, min = 1): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_request', `${field} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(
      400,
      'invalid_request',
      `${field} must contain between ${min} and ${max} characters.`
    );
  }
  return trimmed;
}

function revisionValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, 'invalid_request', `${field} must be a positive whole number.`);
  }
  return value;
}

async function assertActiveCustomer(client: PoolClient, auth: AuthContext): Promise<string> {
  const companyId = requireCustomerCompany(auth);
  // Lock the company and account so a concurrent suspend/deactivate action
  // either sees the new order (and its impact preview) or blocks the submit.
  const result = await client.query<{ company_status: string; user_status: string }>(
    `SELECT c.status AS company_status, u.status AS user_status
     FROM customer_companies c
     JOIN customer_users u ON u.id = $2 AND u.company_id = c.id
     WHERE c.id = $1
     FOR SHARE OF c, u`,
    [companyId, auth.user.id]
  );
  const row = result.rows[0];
  if (!row || row.company_status !== 'active' || row.user_status !== 'active') {
    throw new HttpError(
      403,
      'account_inactive',
      'The customer company or account is no longer active.'
    );
  }
  return companyId;
}

interface CartLineRow {
  sku_id: string;
  quantity: number;
  sku_code: string;
  color_name: string;
  color_name_en: string;
  color_hex: string;
  base_price_cents: number;
  sellable_status: 'active' | 'discontinued';
  product_id: string;
  product_code: string;
  title: string;
  title_en: string;
  published: boolean;
  brand_id: string;
  brand_granted: boolean;
  available: string;
}

const CART_LINES_FOR_ORDER = `
  SELECT ci.sku_id, ci.quantity, s.sku_code, s.color_name, s.color_name_en,
         s.color_hex, s.base_price_cents, s.sellable_status, s.product_id,
         p.product_code, p.title, p.title_en, p.published, p.brand_id,
         EXISTS (
           SELECT 1 FROM brand_grants g
           WHERE g.company_id = ci.company_id AND g.brand_id = p.brand_id
         ) AS brand_granted,
         GREATEST(COALESCE(
           (SELECT SUM(b.on_hand - b.reserved - b.unsellable)
            FROM inventory_balances b WHERE b.sku_id = s.id), 0
         ), 0)::text AS available
  FROM cart_items ci
  JOIN product_skus s ON s.id = ci.sku_id
  JOIN products p ON p.id = s.product_id
  WHERE ci.company_id = $1
  ORDER BY ci.sku_id
`;

function assertLineOrderable(row: CartLineRow, quantity: number): void {
  // Withdrawn catalogue access must also redact validation-error responses.
  if (!row.brand_granted) {
    throw new HttpError(
      422, 'brand_not_authorized', 'Your company is no longer authorized for this brand.'
    );
  }
  if (!row.published) {
    throw new HttpError(422, 'product_unavailable', 'This product is no longer published.');
  }
  if (row.sellable_status !== 'active') {
    throw new HttpError(422, 'sku_unavailable', `SKU ${row.sku_code} is discontinued.`);
  }
  if (!Number.isInteger(quantity) || quantity < SKU_MOQ) {
    throw new HttpError(
      422,
      'moq_not_met',
      `SKU ${row.sku_code} requires at least ${SKU_MOQ} PCS.`
    );
  }
  const available = Number(row.available);
  if (quantity > available) {
    throw new HttpError(
      422,
      'insufficient_stock',
      `SKU ${row.sku_code} only has ${available} PCS available; ${quantity} PCS cannot be ordered.`,
      undefined,
      { skuCode: row.sku_code, available, requested: quantity }
    );
  }
}

export interface SubmitOrderInput {
  idempotencyKey: string;
  expectedCartRevision: number;
  shippingMethod: unknown;
  destinationCountryAlpha3: unknown;
  expectedShipDate: unknown;
  shippingRequirements: unknown;
}

export interface SubmitOrderResult {
  order: CustomerOrderDto;
  alreadySubmitted: boolean;
}

export async function submitOrder(
  pool: DbPool,
  config: { orderNumberTimeZone: string },
  auth: AuthContext,
  input: SubmitOrderInput
): Promise<SubmitOrderResult> {
  const companyId = requireCustomerCompany(auth);
  const idempotencyKey = textValue(input.idempotencyKey, 'idempotencyKey', 128, 8);
  const expectedCartRevision = revisionValue(
    input.expectedCartRevision,
    'expectedCartRevision'
  );
  const delivery: Delivery = validateDelivery(input);
  const digest = orderPayloadDigest(delivery, expectedCartRevision);

  return withTransaction(pool, async client => {
    await assertActiveCustomer(client, auth);
    await client.query(
      'INSERT INTO company_carts (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING',
      [companyId]
    );
    const cart = await client.query<{ revision: string }>(
      'SELECT revision FROM company_carts WHERE company_id = $1 FOR UPDATE',
      [companyId]
    );
    const cartRevision = Number(cart.rows[0].revision);

    const existing = await client.query<{
      payload_digest: string;
      order_id: string;
    }>(
      `SELECT payload_digest, order_id FROM order_idempotency
       WHERE company_id = $1 AND submitted_by_user_id = $2 AND idempotency_key = $3`,
      [companyId, auth.user.id, idempotencyKey]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].payload_digest !== digest) {
        throw new HttpError(
          409,
          'idempotency_conflict',
          'This idempotency key was already used with a different submit payload.'
        );
      }
      const row = await orderRow(client, 'WHERE o.id = $1 AND o.company_id = $2', [
        existing.rows[0].order_id,
        companyId,
      ]);
      if (!row) throw new HttpError(404, 'order_not_found', 'Order not found.');
      return {
        order: await buildCustomerOrder(client, row, auth.user.id),
        alreadySubmitted: true,
      };
    }

    if (cartRevision !== expectedCartRevision) {
      throw new HttpError(
        409,
        'cart_version_conflict',
        'The company cart changed in another session. Review the latest cart and submit again.',
        undefined,
        { cart: await getCartForCompany(client, companyId) }
      );
    }

    // Serialise with administrator unpublish/discontinue actions. The ID reads
    // are immutable; the subsequent cart-line query sees the state after these
    // shared locks have been granted.
    const pointers = await client.query<{ sku_id: string; product_id: string }>(
      `SELECT ci.sku_id, s.product_id
       FROM cart_items ci
       JOIN product_skus s ON s.id = ci.sku_id
       WHERE ci.company_id = $1
       ORDER BY s.product_id, ci.sku_id`,
      [companyId]
    );
    if (pointers.rows.length > 0) {
      const productIds = [...new Set(pointers.rows.map(row => row.product_id))].sort();
      const skuIds = [...new Set(pointers.rows.map(row => row.sku_id))].sort();
      await client.query(
        'SELECT id FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [productIds]
      );
      await client.query(
        'SELECT id FROM product_skus WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [skuIds]
      );
    }

    const lines = await client.query<CartLineRow>(CART_LINES_FOR_ORDER, [companyId]);
    if (lines.rows.length === 0) {
      throw new HttpError(409, 'cart_empty', 'The company cart is empty.');
    }
    for (const line of lines.rows) {
      assertLineOrderable(line, line.quantity);
    }

    const company = await client.query<{
      status: string;
      assigned_sales_user_id: string | null;
      customer_code: string;
    }>(
      `SELECT status, assigned_sales_user_id, customer_code
       FROM customer_companies WHERE id = $1`,
      [companyId]
    );
    const companyRow = company.rows[0];
    if (!companyRow || companyRow.status !== 'active') {
      throw new HttpError(
        403,
        'account_inactive',
        'The customer company or account is no longer active.'
      );
    }

    const computed = lines.rows.map(line => {
      const lineReferenceCents = multiplyCents(line.base_price_cents, line.quantity);
      return { line, lineReferenceCents };
    });
    const referenceTotalCents = sumCents(computed.map(item => item.lineReferenceCents));

    const now = new Date();
    const businessDate = orderBusinessDate(now, config.orderNumberTimeZone);
    const datePart = orderNumberDatePart(now, config.orderNumberTimeZone);
    const sequenceRow = await client.query<{ next_seq: number }>(
      `INSERT INTO order_sequences (order_date, next_seq)
       VALUES ($1::date, 1)
       ON CONFLICT (order_date)
       DO UPDATE SET next_seq = order_sequences.next_seq + 1
       RETURNING next_seq`,
      [businessDate]
    );
    const sequence = sequenceRow.rows[0].next_seq;
    if (sequence > 9999) {
      throw new HttpError(
        503,
        'order_sequence_exhausted',
        'The daily order-number sequence is exhausted. Please try again tomorrow.'
      );
    }
    const orderNo = formatOrderNumber(datePart, sequence);
    const orderId = randomUUID();
    const customerVisibleNote =
      'Order request submitted. Your sales representative will verify quantities and stock before creating a reservation. Submitting does not lock stock.';

    await client.query(
      `INSERT INTO orders
        (id, order_no, company_id, submitted_by_user_id, assigned_sales_user_id, status,
         revision, shipping_method, destination_country_alpha3, expected_ship_date,
         shipping_requirements, pricing_mode, pricing_version, is_reference_quote,
         reference_total_cents, customer_visible_note, submitted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_CONFIRMATION', 1, $6, $7, $8::date,
               $9, $10, $11, true, $12, $13, now(), now(), now())`,
      [
        orderId,
        orderNo,
        companyId,
        auth.user.id,
        companyRow.assigned_sales_user_id,
        delivery.shippingMethod,
        delivery.destinationCountryAlpha3,
        delivery.expectedShipDate,
        delivery.shippingRequirements,
        PRICING_MODE,
        PRICING_VERSION,
        referenceTotalCents,
        customerVisibleNote,
      ]
    );

    for (const [index, item] of computed.entries()) {
      const line = item.line;
      await client.query(
        `INSERT INTO order_items
          (id, order_id, line_number, sku_id, product_id, brand_id, product_code,
           product_title, product_title_en, sku_code, color_name, color_name_en,
           color_hex, quantity, base_unit_price_cents, reference_unit_price_cents,
           line_reference_cents, price_source, pricing_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $15, $16, 'base_price', $17)`,
        [
          randomUUID(),
          orderId,
          index + 1,
          line.sku_id,
          line.product_id,
          line.brand_id,
          line.product_code,
          line.title,
          line.title_en,
          line.sku_code,
          line.color_name,
          line.color_name_en,
          line.color_hex,
          line.quantity,
          line.base_price_cents,
          item.lineReferenceCents,
          PRICING_VERSION,
        ]
      );
    }

    await client.query(
      `INSERT INTO order_status_history
        (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
         actor_label, reason, details)
       VALUES ($1, $2, 'SUBMITTED', NULL, 'PENDING_CONFIRMATION', 'customer', $3, $4, '', $5)`,
      [
        randomUUID(),
        orderId,
        auth.user.id,
        auth.user.username,
        { lineCount: computed.length, referenceTotalCents },
      ]
    );

    await client.query(
      `INSERT INTO order_idempotency
        (company_id, submitted_by_user_id, idempotency_key, payload_digest, order_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, auth.user.id, idempotencyKey, digest, orderId]
    );

    await client.query('DELETE FROM cart_items WHERE company_id = $1', [companyId]);
    await client.query(
      'UPDATE company_carts SET revision = revision + 1, updated_at = now() WHERE company_id = $1',
      [companyId]
    );

    await queueOrderNotifications(client, {
      orderId,
      companyId,
      companyCode: companyRow.customer_code,
      orderNo,
      eventType: 'ORDER_SUBMITTED',
      customerMessage: `Order ${orderNo} was submitted and is awaiting sales confirmation.`,
      salesMessage: `A new pending order ${orderNo} requires review.`,
    });

    await writeAudit(client, {
      ...actor(auth),
      action: 'SUBMIT_ORDER',
      targetType: 'order',
      targetId: orderId,
      details: { orderNo, lineCount: computed.length, referenceTotalCents },
    });

    const row = await orderRow(client, 'WHERE o.id = $1', [orderId]);
    if (!row) throw new HttpError(500, 'order_create_failed', 'The order could not be loaded.');
    return {
      order: await buildCustomerOrder(client, row, auth.user.id),
      alreadySubmitted: false,
    };
  });
}

export async function listCustomerOrders(
  pool: DbPool,
  auth: AuthContext
): Promise<CustomerOrderDto[]> {
  const companyId = requireCustomerCompany(auth);
  const rows = await pool.query<OrderRow>(
    `${ORDER_SELECT} WHERE o.company_id = $1 ORDER BY o.submitted_at DESC, o.id`,
    [companyId]
  );
  const result: CustomerOrderDto[] = [];
  for (const row of rows.rows) {
    result.push(await buildCustomerOrder(pool, row, auth.user.id));
  }
  return result;
}

export async function getCustomerOrder(
  pool: DbPool,
  auth: AuthContext,
  orderId: string
): Promise<CustomerOrderDto> {
  const companyId = requireCustomerCompany(auth);
  const row = await orderRow(pool, 'WHERE o.id = $1 AND o.company_id = $2', [
    orderId,
    companyId,
  ]);
  if (!row) throw new HttpError(404, 'order_not_found', 'Order not found.');
  return buildCustomerOrder(pool, row, auth.user.id);
}

export interface ModifyOrderLinesInput {
  expectedRevision: number;
  lines: Array<{ skuId: string; quantity: number }>;
}

interface OrderSkuStateRow {
  id: string;
  sku_code: string;
  sellable_status: 'active' | 'discontinued';
  published: boolean;
  brand_granted: boolean;
  available: string;
}

async function requireOrderLinesOrderable(
  client: PoolClient,
  companyId: string,
  skuIds: string[],
  quantities: Map<string, number>
): Promise<Map<string, OrderSkuStateRow>> {
  const result = await client.query<OrderSkuStateRow>(
    `SELECT s.id, s.sku_code, s.sellable_status, p.published,
            EXISTS (
              SELECT 1 FROM brand_grants g
              WHERE g.company_id = $2 AND g.brand_id = p.brand_id
            ) AS brand_granted,
            GREATEST(COALESCE(
              (SELECT SUM(b.on_hand - b.reserved - b.unsellable)
               FROM inventory_balances b WHERE b.sku_id = s.id), 0
            ), 0)::text AS available
     FROM product_skus s
     JOIN products p ON p.id = s.product_id
     WHERE s.id = ANY($1::uuid[])`,
    [skuIds, companyId]
  );
  const states = new Map(result.rows.map(row => [row.id, row]));
  for (const skuId of skuIds) {
    const state = states.get(skuId);
    const quantity = quantities.get(skuId)!;
    if (!state) {
      throw new HttpError(422, 'sku_unavailable', `SKU ${skuId} is no longer available.`);
    }
    if (!state.published) {
      throw new HttpError(422, 'product_unavailable', 'This product is no longer published.');
    }
    if (state.sellable_status !== 'active') {
      throw new HttpError(422, 'sku_unavailable', `SKU ${state.sku_code} is discontinued.`);
    }
    if (!state.brand_granted) {
      throw new HttpError(
        422,
        'brand_not_authorized',
        'Your company is no longer authorized for this brand.'
      );
    }
    if (quantity < SKU_MOQ) {
      throw new HttpError(
        422,
        'moq_not_met',
        `SKU ${state.sku_code} requires at least ${SKU_MOQ} PCS.`
      );
    }
    const available = Number(state.available);
    if (quantity > available) {
      throw new HttpError(
        422,
        'insufficient_stock',
        `SKU ${state.sku_code} only has ${available} PCS available; ${quantity} PCS cannot be ordered.`,
        undefined,
        { skuCode: state.sku_code, available, requested: quantity }
      );
    }
  }
  return states;
}

export async function modifyOrderLines(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  input: ModifyOrderLinesInput
): Promise<CustomerOrderDto> {
  const expectedRevision = revisionValue(input.expectedRevision, 'expectedRevision');
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new HttpError(400, 'invalid_lines', 'Provide at least one quantity change.');
  }
  if (input.lines.length > 100) {
    throw new HttpError(400, 'invalid_lines', 'At most 100 quantity changes are supported.');
  }
  const requested = new Map<string, number>();
  for (const line of input.lines) {
    if (!line || typeof line.skuId !== 'string' || !line.skuId.trim()) {
      throw new HttpError(400, 'invalid_lines', 'Each line must include skuId.');
    }
    const skuId = line.skuId.trim();
    if (requested.has(skuId)) {
      throw new HttpError(400, 'invalid_lines', `Duplicate SKU in the quantity change: ${skuId}`);
    }
    requested.set(skuId, validateOrderQuantity(line.quantity));
  }

  return withTransaction(pool, async client => {
    const companyId = await assertActiveCustomer(client, auth);
    const locked = await client.query<OrderRow>(
      `${ORDER_SELECT} WHERE o.id = $1 AND o.company_id = $2 FOR UPDATE OF o`,
      [orderId, companyId]
    );
    const row = locked.rows[0];
    if (!row) throw new HttpError(404, 'order_not_found', 'Order not found.');
    if (row.status !== 'PENDING_CONFIRMATION') {
      throw new HttpError(
        409,
        'order_status_conflict',
        'Only an order pending confirmation can be changed.'
      );
    }
    if (row.current_plan_version > 0) {
      throw new HttpError(
        409,
        'active_plan_exists',
        'A sales plan is active for this order. Reject the plan or wait for the salesperson to replace it before changing quantities.',
        undefined,
        { planVersion: row.current_plan_version }
      );
    }
    if (Number(row.revision) !== expectedRevision) {
      throw new HttpError(
        409,
        'order_version_conflict',
        'The order changed in another session. Reload and retry.',
        undefined,
        { order: await buildCustomerOrder(client, row, auth.user.id) }
      );
    }

    const lines = await loadLines(client, orderId);
    const bySku = new Map(lines.map(line => [line.sku_id, line]));
    for (const skuId of requested.keys()) {
      if (!bySku.has(skuId)) {
        throw new HttpError(
          422,
          'invalid_order_line',
          `SKU ${skuId} is not part of this order.`
        );
      }
    }
    const quantities = new Map<string, number>();
    for (const line of lines) {
      quantities.set(line.sku_id, requested.get(line.sku_id) ?? line.quantity);
    }
    const changed = lines.some(line => quantities.get(line.sku_id) !== line.quantity);
    if (!changed) {
      throw new HttpError(400, 'no_change', 'The supplied quantities are unchanged.');
    }

    await requireOrderLinesOrderable(
      client,
      companyId,
      lines.map(line => line.sku_id),
      quantities
    );

    const newTotals = new Map<string, number>();
    for (const line of lines) {
      newTotals.set(
        line.sku_id,
        multiplyCents(line.reference_unit_price_cents, quantities.get(line.sku_id)!)
      );
    }
    const referenceTotalCents = sumCents([...newTotals.values()]);

    for (const line of lines) {
      const quantity = quantities.get(line.sku_id)!;
      if (quantity === line.quantity) continue;
      await client.query(
        'UPDATE order_items SET quantity = $2, line_reference_cents = $3 WHERE id = $1',
        [line.id, quantity, newTotals.get(line.sku_id)!]
      );
    }
    await client.query(
      `UPDATE orders SET reference_total_cents = $2, revision = revision + 1, updated_at = now()
       WHERE id = $1`,
      [orderId, referenceTotalCents]
    );

    const changes = lines
      .filter(line => quantities.get(line.sku_id) !== line.quantity)
      .map(line => ({
        skuId: line.sku_id,
        skuCode: line.sku_code,
        from: line.quantity,
        to: quantities.get(line.sku_id)!,
      }));
    await client.query(
      `INSERT INTO order_status_history
        (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
         actor_label, reason, details)
       VALUES ($1, $2, 'LINES_MODIFIED', 'PENDING_CONFIRMATION', 'PENDING_CONFIRMATION',
               'customer', $3, $4, '', $5)`,
      [
        randomUUID(),
        orderId,
        auth.user.id,
        auth.user.username,
        {
          changes,
          previousTotalCents: Number(row.reference_total_cents),
          newTotalCents: referenceTotalCents,
        },
      ]
    );
    await queueOrderNotifications(client, {
      orderId,
      companyId,
      companyCode: row.company_code,
      orderNo: row.order_no,
      eventType: 'ORDER_MODIFIED',
      customerMessage: `Quantities for order ${row.order_no} were updated.`,
      salesMessage: `Customer quantities for pending order ${row.order_no} were updated.`,
    });
    await writeAudit(client, {
      ...actor(auth),
      action: 'MODIFY_ORDER',
      targetType: 'order',
      targetId: orderId,
      details: {
        orderNo: row.order_no,
        changes,
        previousTotalCents: Number(row.reference_total_cents),
        newTotalCents: referenceTotalCents,
      },
    });

    const updated = await orderRow(client, 'WHERE o.id = $1', [orderId]);
    return buildCustomerOrder(client, updated!, auth.user.id);
  });
}

export interface CancelOrderInput {
  expectedRevision: number;
  reason?: string;
}

export async function cancelCustomerOrder(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  input: CancelOrderInput
): Promise<CustomerOrderDto> {
  const expectedRevision = revisionValue(input.expectedRevision, 'expectedRevision');
  const reason =
    input.reason === undefined
      ? 'Customer cancelled before confirmation.'
      : textValue(input.reason, 'reason', 500);
  const privacy = checkPrivacyViolations(reason);
  if (privacy.hasViolation) {
    throw new HttpError(422, 'privacy_violation', privacy.message ?? 'Privacy check failed.');
  }
  return withTransaction(pool, async client => {
    const companyId = await assertActiveCustomer(client, auth);
    const locked = await client.query<OrderRow>(
      `${ORDER_SELECT} WHERE o.id = $1 AND o.company_id = $2 FOR UPDATE OF o`,
      [orderId, companyId]
    );
    const row = locked.rows[0];
    if (!row) throw new HttpError(404, 'order_not_found', 'Order not found.');
    if (row.status !== 'PENDING_CONFIRMATION') {
      throw new HttpError(
        409,
        'order_status_conflict',
        'Only an order pending confirmation can be cancelled here.'
      );
    }
    if (Number(row.revision) !== expectedRevision) {
      throw new HttpError(
        409,
        'order_version_conflict',
        'The order changed in another session. Reload and retry.',
        undefined,
        { order: await buildCustomerOrder(client, row, auth.user.id) }
      );
    }

    // The legacy 4B-04 pending-cancel path stays available after a plan is
    // proposed. It supersedes the active plan/acceptance and pending price
    // approval in the same transaction. It can never reach a CONFIRMED order
    // because the status check above rejects it.
    if (row.current_plan_version > 0) {
      await client.query(
        `UPDATE order_plans
         SET status = CASE WHEN status = 'REJECTED' THEN status ELSE 'SUPERSEDED' END,
             decided_at = now()
         WHERE order_id = $1 AND plan_version = $2`,
        [orderId, row.current_plan_version]
      );
      await client.query(
        `UPDATE order_plan_acceptances
         SET invalidated_at = now(), invalidation_reason = 'order_cancelled'
         WHERE order_id = $1 AND invalidated_at IS NULL`,
        [orderId]
      );
      await client.query(
        `UPDATE order_price_approvals
         SET status = 'SUPERSEDED', decided_at = now(),
             decision_note = 'Order cancelled before the price approval was decided.'
         WHERE order_id = $1 AND status = 'PENDING'`,
        [orderId]
      );
    }

    await client.query(
      `UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2,
         cancellation_kind = 'CUSTOMER',
         customer_visible_note = $3, revision = revision + 1, updated_at = now()
       WHERE id = $1`,
      [orderId, reason, `The customer cancelled this pending request. Reason: ${reason}`]
    );
    await client.query(
      `INSERT INTO order_status_history
        (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
         actor_label, reason, details)
       VALUES ($1, $2, 'CANCELLED', 'PENDING_CONFIRMATION', 'CANCELLED', 'customer', $3, $4, $5, '{}')`,
      [randomUUID(), orderId, auth.user.id, auth.user.username, reason]
    );
    await queueOrderNotifications(client, {
      orderId,
      companyId,
      companyCode: row.company_code,
      orderNo: row.order_no,
      eventType: 'ORDER_CANCELLED',
      customerMessage: `Order ${row.order_no} was cancelled.`,
      salesMessage: `Customer cancelled pending order ${row.order_no}.`,
    });
    await writeAudit(client, {
      ...actor(auth),
      action: 'CANCEL_ORDER',
      targetType: 'order',
      targetId: orderId,
      details: { orderNo: row.order_no, reason },
    });

    const updated = await orderRow(client, 'WHERE o.id = $1', [orderId]);
    return buildCustomerOrder(client, updated!, auth.user.id);
  });
}

function canReadAllOrders(auth: AuthContext): boolean {
  return auth.user.permissions.includes('sales.read_all');
}

function canReadAssignedOrders(auth: AuthContext): boolean {
  return auth.user.permissions.includes('sales.read_assigned');
}

async function listInternalOrders(
  pool: DbPool,
  auth: AuthContext,
  mode: 'sales' | 'admin'
): Promise<InternalOrderDto[]> {
  if (auth.user.type !== 'internal') {
    throw new HttpError(403, 'forbidden', 'An internal session is required.');
  }
  const readAll = canReadAllOrders(auth);
  const readAssigned = canReadAssignedOrders(auth);
  if (mode === 'admin' && !readAll) {
    throw new HttpError(403, 'forbidden', 'You do not have order supervision permission.');
  }
  if (!readAll && !(mode === 'sales' && readAssigned)) {
    throw new HttpError(403, 'forbidden', 'You do not have access to customer orders.');
  }
  const rows = readAll
    ? await pool.query<OrderRow>(`${ORDER_SELECT} ORDER BY o.submitted_at DESC, o.id`)
    : await pool.query<OrderRow>(
        `${ORDER_SELECT} WHERE c.assigned_sales_user_id = $1
         ORDER BY o.submitted_at DESC, o.id`,
        [auth.user.id]
      );
  const result: InternalOrderDto[] = [];
  for (const row of rows.rows) {
    result.push(await buildInternalOrder(pool, row));
  }
  return result;
}

export function listSalesOrders(pool: DbPool, auth: AuthContext): Promise<InternalOrderDto[]> {
  return listInternalOrders(pool, auth, 'sales');
}

export function listAdminOrders(pool: DbPool, auth: AuthContext): Promise<InternalOrderDto[]> {
  return listInternalOrders(pool, auth, 'admin');
}

async function getInternalOrder(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  mode: 'sales' | 'admin'
): Promise<InternalOrderDto> {
  if (auth.user.type !== 'internal') {
    throw new HttpError(403, 'forbidden', 'An internal session is required.');
  }
  const readAll = canReadAllOrders(auth);
  const readAssigned = canReadAssignedOrders(auth);
  if (mode === 'admin' && !readAll) {
    throw new HttpError(403, 'forbidden', 'You do not have order supervision permission.');
  }
  if (!readAll && !(mode === 'sales' && readAssigned)) {
    throw new HttpError(403, 'forbidden', 'You do not have access to customer orders.');
  }
  const row = readAll
    ? await orderRow(pool, 'WHERE o.id = $1', [orderId])
    : await orderRow(pool, 'WHERE o.id = $1 AND c.assigned_sales_user_id = $2', [
        orderId, auth.user.id,
      ]);
  if (!row) throw new HttpError(404, 'order_not_found', 'Order not found.');
  return buildInternalOrder(pool, row);
}

export function getSalesOrder(
  pool: DbPool,
  auth: AuthContext,
  orderId: string
): Promise<InternalOrderDto> {
  return getInternalOrder(pool, auth, orderId, 'sales');
}

export function getAdminOrder(
  pool: DbPool,
  auth: AuthContext,
  orderId: string
): Promise<InternalOrderDto> {
  return getInternalOrder(pool, auth, orderId, 'admin');
}
