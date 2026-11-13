import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export type OrderNotificationEvent =
  | 'ORDER_SUBMITTED'
  | 'ORDER_MODIFIED'
  | 'ORDER_CANCELLED'
  | 'ORDER_CANCELLED_BY_ADMIN'
  | 'PLAN_READY'
  | 'PLAN_ACCEPTED'
  | 'PLAN_REJECTED'
  | 'PRICE_APPROVAL_REQUIRED'
  | 'PRICE_APPROVED'
  | 'PRICE_REJECTED'
  | 'ORDER_CONFIRMED'
  | 'RESERVATION_EXPIRING'
  | 'RESERVATION_EXPIRED'
  | 'RESERVATION_EXTENDED'
  | 'RESERVATION_RELEASED'
  | 'EXTENSION_REQUESTED'
  | 'EXTENSION_DECIDED'
  | 'RELEASE_REQUESTED'
  | 'RELEASE_DECIDED'
  | 'CONFIRMED_RESERVATION_EXCEPTION'
  | 'ORDER_CANCELLED_AFTER_CONFIRMATION';

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

export interface InternalNotificationInput {
  orderId: string;
  companyId: string;
  orderNo: string;
  companyCode: string;
  eventType: OrderNotificationEvent;
  internalUserId: string;
  title: string;
  message: string;
}

/** One internal outbox row. Used for the current salesperson, business admins
 * and deadline reminders. The audience vocabulary stays 'sales' for internal
 * recipients; the recipient column carries the exact account. */
export async function queueInternalNotification(
  client: PoolClient,
  input: InternalNotificationInput
): Promise<void> {
  await client.query(
    `INSERT INTO order_notifications
      (id, order_id, company_id, audience, internal_user_id, event_type, title, message, status)
     VALUES ($1, $2, $3, 'sales', $4, $5, $6, $7, 'pending')`,
    [
      randomUUID(),
      input.orderId,
      input.companyId,
      input.internalUserId,
      input.eventType,
      input.title,
      input.message,
    ]
  );
}

/**
 * Queue one row per active holder of the exact approval permission. Role name,
 * `sales.read_all`, administrator status or a frontend menu are never used as a
 * substitute: the permission table is the only source of truth.
 */
export async function queueBusinessAdminNotifications(
  client: PoolClient,
  input: Omit<InternalNotificationInput, 'internalUserId'> & { permission: string }
): Promise<string[]> {
  const holders = await client.query<{ id: string }>(
    `SELECT DISTINCT iu.id
     FROM internal_users iu
     WHERE iu.status = 'active' AND (
       EXISTS (
         SELECT 1 FROM internal_user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE ur.internal_user_id = iu.id AND rp.permission_id = $1
       )
       OR EXISTS (
         SELECT 1 FROM internal_user_permissions up
         WHERE up.internal_user_id = iu.id AND up.permission_id = $1
       )
     )
     ORDER BY iu.id`,
    [input.permission]
  );
  for (const holder of holders.rows) {
    await queueInternalNotification(client, { ...input, internalUserId: holder.id });
  }
  return holders.rows.map(row => row.id);
}
