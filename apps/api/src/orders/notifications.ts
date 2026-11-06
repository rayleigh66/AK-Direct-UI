import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export type OrderNotificationEvent =
  | 'ORDER_SUBMITTED'
  | 'ORDER_MODIFIED'
  | 'ORDER_CANCELLED'
  | 'ORDER_CANCELLED_BY_ADMIN';

export interface QueueOrderNotificationsInput {
  orderId: string;
  companyId: string;
  companyCode: string;
  orderNo: string;
  eventType: OrderNotificationEvent;
  customerMessage: string;
  salesMessage: string;
}

/**
 * Resolve the CURRENT assigned salesperson under a shared company lock and
 * queue the outbox rows. A reassignment transaction takes the matching
 * FOR UPDATE lock and cancels any pending sales row for the former owner, so a
 * notification committed before the reassignment is invalidated afterwards.
 */
export async function queueOrderNotifications(
  client: PoolClient,
  input: QueueOrderNotificationsInput
): Promise<void> {
  const company = await client.query<{ assigned_sales_user_id: string | null }>(
    `SELECT assigned_sales_user_id FROM customer_companies
     WHERE id = $1 FOR SHARE`,
    [input.companyId]
  );
  const assignedSalesUserId = company.rows[0]?.assigned_sales_user_id ?? null;

  await client.query(
    `INSERT INTO order_notifications
      (id, order_id, company_id, audience, internal_user_id, event_type, title, message, status)
     VALUES ($1, $2, $3, 'customer', NULL, $4, $5, $6, 'pending')`,
    [
      randomUUID(),
      input.orderId,
      input.companyId,
      input.eventType,
      `Order ${input.orderNo}`,
      input.customerMessage,
    ]
  );

  if (assignedSalesUserId) {
    await client.query(
      `INSERT INTO order_notifications
        (id, order_id, company_id, audience, internal_user_id, event_type, title, message, status)
       VALUES ($1, $2, $3, 'sales', $4, $5, $6, $7, 'pending')`,
      [
        randomUUID(),
        input.orderId,
        input.companyId,
        assignedSalesUserId,
        input.eventType,
        `Order ${input.orderNo} · ${input.companyCode}`,
        input.salesMessage,
      ]
    );
  }
}

/**
 * Invalidate unsent sales notifications that no longer match the company's
 * current assignee. Called inside the sales-assignment transaction.
 */
export async function cancelStaleSalesNotifications(
  client: PoolClient,
  companyId: string,
  currentSalesUserId: string | null
): Promise<number> {
  const result = await client.query(
    `UPDATE order_notifications
     SET status = 'cancelled', cancelled_at = now()
     WHERE company_id = $1
       AND audience = 'sales'
       AND status = 'pending'
       AND internal_user_id IS DISTINCT FROM $2`,
    [companyId, currentSalesUserId]
  );
  return result.rowCount ?? 0;
}
