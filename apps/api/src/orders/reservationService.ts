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
import { actionPayloadDigest, requireIdempotencyKey, requireReservationVersion } from './planValidation.js';
import { replayIdempotentResult, storeIdempotentResult } from './idempotency.js';
import { MAX_TOTAL_EXTENSION_HOURS } from './validation.js';

const EXPIRY_SCAN_BATCH = 100;

interface ReservationRow {
  id: string;
  order_id: string;
  company_id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
  reservation_version: string;
  confirmed_at: Date;
  expires_at: Date;
  hard_deadline_at: Date;
  total_extension_hours: number;
  released_at: Date | null;
  release_reason: string | null;
}

interface ExtensionRequestRow {
  id: string;
  order_id: string;
  company_id: string;
  requested_by_user_id: string;
  requested_by_label: string;
  additional_hours: number;
  reason: string;
  expected_expires_at: Date;
  expected_reservation_version: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_at: Date;
  decided_by_label: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  previous_expires_at: Date | null;
  new_expires_at: Date | null;
}

interface ReleaseRequestRow {
  id: string;
  order_id: string;
  company_id: string;
  requested_by_user_id: string;
  requested_by_label: string;
  reason: string;
  payment_verification: string;
  shipment_verification: string;
  verification_note: string;
  verified_by_user_id: string;
  verified_at: Date;
  expected_reservation_version: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_at: Date;
  decided_by_label: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  executed_at: Date | null;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, 'invalid_request', 'expectedRevision must be a positive whole number.');
  }
  return value;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_request', `${field} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new HttpError(400, 'invalid_request', `${field} must contain 1 to ${max} characters.`);
  }
  return trimmed;
}

function requireApprovalPermission(auth: AuthContext, permission: string): void {
  if (auth.user.type !== 'internal' || !auth.user.permissions.includes(permission)) {
    throw new HttpError(403, 'forbidden', `The ${permission} permission is required.`);
  }
}

async function loadReservation(
  client: PoolClient,
  orderId: string,
  lock = true
): Promise<ReservationRow> {
  const result = await client.query<ReservationRow>(
    `SELECT * FROM order_reservations WHERE order_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [orderId]
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'reservation_not_found', 'Reservation not found.');
  return row;
}

async function dbNow(client: PoolClient): Promise<Date> {
  // clock_timestamp() is evaluated after the necessary locks have been
  // acquired. now() would be the transaction start and could make an expired
  // request look valid after waiting on a lock.
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return new Date(result.rows[0].now);
}

export interface ExtensionRequestInput {
  expectedRevision: unknown;
  expectedReservationVersion: unknown;
  additionalHours: unknown;
  reason: unknown;
  idempotencyKey: unknown;
}

export interface ExtensionRequestDto {
  id: string;
  orderId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  additionalHours: number;
  reason: string;
  expectedExpiresAt: string;
  requestedByLabel: string;
  requestedAt: string;
  decidedByLabel: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  previousExpiresAt: string | null;
  newExpiresAt: string | null;
}

function extensionDto(row: ExtensionRequestRow): ExtensionRequestDto {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    additionalHours: row.additional_hours,
    reason: row.reason,
    expectedExpiresAt: new Date(row.expected_expires_at).toISOString(),
    requestedByLabel: row.requested_by_label,
    requestedAt: new Date(row.requested_at).toISOString(),
    decidedByLabel: row.decided_by_label,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    decisionNote: row.decision_note,
    previousExpiresAt: row.previous_expires_at
      ? new Date(row.previous_expires_at).toISOString()
      : null,
    newExpiresAt: row.new_expires_at ? new Date(row.new_expires_at).toISOString() : null,
  };
}

export interface ReleaseRequestDto {
  id: string;
  orderId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  paymentVerification: string;
  shipmentVerification: string;
  verificationNote: string;
  verifiedByUserId: string;
  verifiedAt: string;
  requestedByLabel: string;
  requestedAt: string;
  decidedByLabel: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedAt: string | null;
}

function releaseDto(row: ReleaseRequestRow): ReleaseRequestDto {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    reason: row.reason,
    paymentVerification: row.payment_verification,
    shipmentVerification: row.shipment_verification,
    verificationNote: row.verification_note,
    verifiedByUserId: row.verified_by_user_id,
    verifiedAt: new Date(row.verified_at).toISOString(),
    requestedByLabel: row.requested_by_label,
    requestedAt: new Date(row.requested_at).toISOString(),
    decidedByLabel: row.decided_by_label,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    decisionNote: row.decision_note,
    executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : null,
  };
}

export async function requestReservationExtension(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  input: ExtensionRequestInput
): Promise<{ order: InternalOrderDto; request: ExtensionRequestDto }> {
  const expectedRevision = revision(input.expectedRevision);
  const expectedVersion = requireReservationVersion(input.expectedReservationVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  if (
    typeof input.additionalHours !== 'number' ||
    !Number.isInteger(input.additionalHours) ||
    input.additionalHours < 1 ||
    input.additionalHours > MAX_TOTAL_EXTENSION_HOURS
  ) {
    throw new HttpError(
      400,
      'invalid_extension_hours',
      `additionalHours must be a whole number from 1 to ${MAX_TOTAL_EXTENSION_HOURS}.`
    );
  }
  const additionalHours = input.additionalHours;
  const reason = text(input.reason, 'reason', 1000);
  const digest = actionPayloadDigest('REQUEST_RESERVATION_EXTENSION', {
    orderId,
    expectedRevision,
    expectedReservationVersion: expectedVersion,
    additionalHours,
    reason,
  });

  return withTransaction(pool, async client => {
    const { order, companyId } = await lockOrderForCurrentSalesWrite(client, auth, orderId);
    const scope = {
      operation: 'REQUEST_RESERVATION_EXTENSION',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId,
      companyId,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<{
      order: InternalOrderDto;
      request: ExtensionRequestDto;
    }>(client, scope);
    if (replayed) return replayed;

    if (order.status !== 'CONFIRMED') {
      throw new HttpError(409, 'order_status_conflict', 'Only a confirmed order can be extended.');
    }
    if (Number(order.revision) !== expectedRevision) {
      throw new HttpError(409, 'order_version_conflict', 'The order changed. Reload and retry.');
    }
    const reservation = await loadReservation(client, orderId, true);
    if (reservation.status === 'RELEASED') {
      throw new HttpError(409, 'reservation_released', 'This reservation was already released.');
    }
    if (Number(reservation.reservation_version) !== expectedVersion) {
      throw new HttpError(
        409,
        'reservation_version_conflict',
        'The reservation changed. Reload and retry.'
      );
    }
    const pending = await client.query(
      `SELECT 1 FROM order_extension_requests
       WHERE order_id = $1 AND status = 'PENDING' LIMIT 1`,
      [orderId]
    );
    if (pending.rowCount) {
      throw new HttpError(409, 'extension_already_pending', 'An extension request is already pending.');
    }
    const newTotal = reservation.total_extension_hours + additionalHours;
    if (newTotal > MAX_TOTAL_EXTENSION_HOURS) {
      throw new HttpError(
        422,
        'extension_limit_exceeded',
        `At most ${MAX_TOTAL_EXTENSION_HOURS} additional hours may be approved for one order.`
      );
    }
    const now = await dbNow(client);
    const newExpires = new Date(
      new Date(reservation.expires_at).getTime() + additionalHours * 3_600_000
    );
    if (newExpires.getTime() <= now.getTime()) {
      throw new HttpError(
        422,
        'extension_does_not_recover',
        'The extension must move the deadline beyond the current database time.'
      );
    }
    if (newExpires.getTime() > new Date(reservation.hard_deadline_at).getTime()) {
      throw new HttpError(
        422,
        'extension_exceeds_hard_deadline',
        'The extension would exceed the hard reservation ceiling.'
      );
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO order_extension_requests
        (id, order_id, company_id, requested_by_user_id, requested_by_label,
         additional_hours, reason, expected_expires_at, expected_reservation_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        orderId,
        companyId,
        auth.user.id,
        auth.user.username,
        additionalHours,
        reason,
        reservation.expires_at,
        reservation.reservation_version,
      ]
    );
    await queueBusinessAdminNotifications(client, {
      orderId,
      companyId,
      orderNo: order.order_no,
      companyCode: order.company_code,
      eventType: 'EXTENSION_REQUESTED',
      title: `Extension request · ${order.order_no}`,
      message: `${auth.user.username} requested ${additionalHours}h for order ${order.order_no}.`,
      permission: 'orders.approve_extension',
    });
    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: 'REQUEST_RESERVATION_EXTENSION',
      targetType: 'order',
      targetId: orderId,
      details: { orderNo: order.order_no, additionalHours, reason },
    });
    const requestRow = await client.query<ExtensionRequestRow>(
      'SELECT * FROM order_extension_requests WHERE id = $1',
      [id]
    );
    const fresh = await orderRow(client, 'WHERE o.id = $1', [orderId]);
    const result = {
      order: await buildInternalOrder(client, fresh!),
      request: extensionDto(requestRow.rows[0]),
    };
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

export interface ReservationDecisionInput {
  decision: unknown;
  note?: unknown;
  expectedReservationVersion: unknown;
  idempotencyKey: unknown;
}

export async function decideReservationExtension(
  pool: DbPool,
  auth: AuthContext,
  requestId: string,
  input: ReservationDecisionInput
): Promise<{ order: InternalOrderDto; request: ExtensionRequestDto }> {
  requireApprovalPermission(auth, 'orders.approve_extension');
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    throw new HttpError(400, 'invalid_decision', 'decision must be APPROVED or REJECTED.');
  }
  const decision = input.decision;
  const expectedVersion = requireReservationVersion(input.expectedReservationVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  const note =
    input.note === undefined
      ? ''
      : typeof input.note === 'string'
        ? input.note.trim().slice(0, 1000)
        : (() => {
            throw new HttpError(400, 'invalid_request', 'note must be text.');
          })();
  const digest = actionPayloadDigest('DECIDE_RESERVATION_EXTENSION', {
    requestId,
    decision,
    note,
    expectedReservationVersion: expectedVersion,
  });

  return withTransaction(pool, async client => {
    const pointer = await client.query<{ order_id: string }>(
      'SELECT order_id FROM order_extension_requests WHERE id = $1',
      [requestId]
    );
    if (!pointer.rows[0]) {
      throw new HttpError(404, 'extension_request_not_found', 'Extension request not found.');
    }
    const order = await lockOrderForApproval(client, pointer.rows[0].order_id);
    await assertCurrentSession(client, auth, 'orders.approve_extension');
    const scope = {
      operation: 'DECIDE_RESERVATION_EXTENSION',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId: order.id,
      companyId: order.company_id,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<{
      order: InternalOrderDto;
      request: ExtensionRequestDto;
    }>(client, scope);
    if (replayed) return replayed;

    const requestResult = await client.query<ExtensionRequestRow>(
      'SELECT * FROM order_extension_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );
    const request = requestResult.rows[0];
    if (!request) {
      throw new HttpError(404, 'extension_request_not_found', 'Extension request not found.');
    }
    if (request.status !== 'PENDING') {
      throw new HttpError(409, 'request_already_decided', 'This extension request was already decided.');
    }
    if (order.status !== 'CONFIRMED') {
      throw new HttpError(409, 'order_status_conflict', 'Only a confirmed order can be extended.');
    }
    const reservation = await loadReservation(client, order.id, true);
    if (reservation.status === 'RELEASED') {
      throw new HttpError(409, 'reservation_released', 'This reservation was already released.');
    }
    if (Number(reservation.reservation_version) !== expectedVersion) {
      throw new HttpError(
        409,
        'reservation_version_conflict',
        'The reservation changed. Review the latest state.'
      );
    }
    if (new Date(request.expected_expires_at).getTime() !== new Date(reservation.expires_at).getTime()) {
      throw new HttpError(
        409,
        'extension_request_stale',
        'The reservation deadline changed after this request. Review the latest state.'
      );
    }

    if (decision === 'APPROVED') {
      const newTotal = reservation.total_extension_hours + request.additional_hours;
      const now = await dbNow(client);
      const newExpires = new Date(
        new Date(reservation.expires_at).getTime() + request.additional_hours * 3_600_000
      );
      if (newTotal > MAX_TOTAL_EXTENSION_HOURS) {
        throw new HttpError(
          422,
          'extension_limit_exceeded',
          `At most ${MAX_TOTAL_EXTENSION_HOURS} additional hours may be approved.`
        );
      }
      if (newExpires.getTime() > new Date(reservation.hard_deadline_at).getTime()) {
        throw new HttpError(
          422,
          'extension_exceeds_hard_deadline',
          'The extension would exceed the hard reservation ceiling.'
        );
      }
      if (newExpires.getTime() <= now.getTime()) {
        throw new HttpError(
          422,
          'extension_does_not_recover',
          'The extension must move the deadline beyond the current database time.'
        );
      }
      await client.query(
        `UPDATE order_reservations
         SET expires_at = $2, total_extension_hours = $3,
             status = CASE WHEN status = 'EXPIRED' THEN 'ACTIVE' ELSE status END,
             reservation_version = reservation_version + 1, updated_at = now()
         WHERE id = $1`,
        [reservation.id, newExpires, newTotal]
      );
      await client.query(
        `UPDATE order_extension_requests
         SET status = 'APPROVED', decided_by_user_id = $2, decided_by_label = $3,
             decided_at = now(), decision_note = $4, previous_expires_at = $5,
             new_expires_at = $6
         WHERE id = $1`,
        [
          requestId,
          auth.user.id,
          auth.user.username,
          note,
          reservation.expires_at,
          newExpires,
        ]
      );
      await client.query(
        `INSERT INTO order_status_history
          (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
           actor_label, reason, details)
         VALUES ($1, $2, 'RESERVATION_EXTENDED', 'CONFIRMED', 'CONFIRMED',
                 'internal', $3, $4, $5, $6)`,
        [
          randomUUID(),
          order.id,
          auth.user.id,
          auth.user.username,
          note,
          {
            requestId,
            additionalHours: request.additional_hours,
            previousExpiresAt: new Date(reservation.expires_at).toISOString(),
            newExpiresAt: newExpires.toISOString(),
            totalExtensionHours: newTotal,
          },
        ]
      );
      await queueOrderNotifications(client, {
        orderId: order.id,
        companyId: order.company_id,
        companyCode: order.company_code,
        orderNo: order.order_no,
        eventType: 'RESERVATION_EXTENDED',
        customerMessage: `The reservation for order ${order.order_no} was extended to ${newExpires.toISOString()}.`,
        salesMessage: `Reservation for ${order.order_no} extended to ${newExpires.toISOString()}.`,
      });
      if (
        order.current_assigned_sales_user_id &&
        order.current_assigned_sales_user_id !== request.requested_by_user_id
      ) {
        await queueInternalNotification(client, {
          orderId: order.id,
          companyId: order.company_id,
          orderNo: order.order_no,
          companyCode: order.company_code,
          eventType: 'EXTENSION_DECIDED',
          internalUserId: request.requested_by_user_id,
          title: `Extension approved · ${order.order_no}`,
          message: `Your extension request for order ${order.order_no} was approved.`,
        });
      }
      await writeAudit(client, {
        actorType: auth.user.type,
        actorId: auth.user.id,
        actorLabel: auth.user.username,
        action: 'APPROVE_RESERVATION_EXTENSION',
        targetType: 'order',
        targetId: order.id,
        details: {
          orderNo: order.order_no,
          requestId,
          additionalHours: request.additional_hours,
          previousExpiresAt: new Date(reservation.expires_at).toISOString(),
          newExpiresAt: newExpires.toISOString(),
          requestedByLabel: request.requested_by_label,
          note,
        },
      });
    } else {
      await client.query(
        `UPDATE order_extension_requests
         SET status = 'REJECTED', decided_by_user_id = $2, decided_by_label = $3,
             decided_at = now(), decision_note = $4
         WHERE id = $1`,
        [requestId, auth.user.id, auth.user.username, note]
      );
      await queueInternalNotification(client, {
        orderId: order.id,
        companyId: order.company_id,
        orderNo: order.order_no,
        companyCode: order.company_code,
        eventType: 'EXTENSION_DECIDED',
        internalUserId: request.requested_by_user_id,
        title: `Extension declined · ${order.order_no}`,
        message: `Your extension request for order ${order.order_no} was declined.`,
      });
      await writeAudit(client, {
        actorType: auth.user.type,
        actorId: auth.user.id,
        actorLabel: auth.user.username,
        action: 'REJECT_RESERVATION_EXTENSION',
        targetType: 'order',
        targetId: order.id,
        details: { orderNo: order.order_no, requestId, note },
      });
    }

    const fresh = await orderRow(client, 'WHERE o.id = $1', [order.id]);
    const requestRow = await client.query<ExtensionRequestRow>(
      'SELECT * FROM order_extension_requests WHERE id = $1',
      [requestId]
    );
    const result = {
      order: await buildInternalOrder(client, fresh!),
      request: extensionDto(requestRow.rows[0]),
    };
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

export interface ReleaseRequestInput {
  expectedRevision: unknown;
  expectedReservationVersion: unknown;
  reason: unknown;
  paymentVerification: unknown;
  shipmentVerification: unknown;
  verificationNote: unknown;
  idempotencyKey: unknown;
}

export async function requestOrderRelease(
  pool: DbPool,
  auth: AuthContext,
  orderId: string,
  input: ReleaseRequestInput
): Promise<{ order: InternalOrderDto; request: ReleaseRequestDto }> {
  const expectedRevision = revision(input.expectedRevision);
  const expectedVersion = requireReservationVersion(input.expectedReservationVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  const reason = text(input.reason, 'reason', 1000);
  const verificationNote = text(input.verificationNote, 'verificationNote', 1000);
  if (input.paymentVerification !== 'unpaid') {
    throw new HttpError(
      422,
      'payment_verification_required',
      'Full release requires an explicit verification that the order is unpaid.'
    );
  }
  if (input.shipmentVerification !== 'not_shipped') {
    throw new HttpError(
      422,
      'shipment_verification_required',
      'Full release requires an explicit verification that nothing has been shipped.'
    );
  }
  const digest = actionPayloadDigest('REQUEST_ORDER_RELEASE', {
    orderId,
    expectedRevision,
    expectedReservationVersion: expectedVersion,
    reason,
    paymentVerification: 'unpaid',
    shipmentVerification: 'not_shipped',
    verificationNote,
  });

  return withTransaction(pool, async client => {
    const { order, companyId } = await lockOrderForCurrentSalesWrite(client, auth, orderId);
    const scope = {
      operation: 'REQUEST_ORDER_RELEASE',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId,
      companyId,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<{
      order: InternalOrderDto;
      request: ReleaseRequestDto;
    }>(client, scope);
    if (replayed) return replayed;

    if (order.status !== 'CONFIRMED') {
      throw new HttpError(409, 'order_status_conflict', 'Only a confirmed order can be released.');
    }
    if (Number(order.revision) !== expectedRevision) {
      throw new HttpError(409, 'order_version_conflict', 'The order changed. Reload and retry.');
    }
    const reservation = await loadReservation(client, orderId, true);
    if (reservation.status === 'RELEASED') {
      throw new HttpError(409, 'reservation_released', 'This reservation was already released.');
    }
    if (Number(reservation.reservation_version) !== expectedVersion) {
      throw new HttpError(
        409,
        'reservation_version_conflict',
        'The reservation changed. Reload and retry.'
      );
    }
    const pending = await client.query(
      `SELECT 1 FROM order_release_requests
       WHERE order_id = $1 AND status = 'PENDING' LIMIT 1`,
      [orderId]
    );
    if (pending.rowCount) {
      throw new HttpError(409, 'release_already_pending', 'A release request is already pending.');
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO order_release_requests
        (id, order_id, company_id, requested_by_user_id, requested_by_label,
         reason, payment_verification, shipment_verification, verification_note,
         verified_by_user_id, verified_at, expected_reservation_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'unpaid', 'not_shipped', $7, $4, now(), $8)`,
      [
        id,
        orderId,
        companyId,
        auth.user.id,
        auth.user.username,
        reason,
        verificationNote,
        reservation.reservation_version,
      ]
    );
    await queueBusinessAdminNotifications(client, {
      orderId,
      companyId,
      orderNo: order.order_no,
      companyCode: order.company_code,
      eventType: 'RELEASE_REQUESTED',
      title: `Release request · ${order.order_no}`,
      message: `${auth.user.username} requested a verified full release for order ${order.order_no}.`,
      permission: 'orders.approve_release',
    });
    await writeAudit(client, {
      actorType: auth.user.type,
      actorId: auth.user.id,
      actorLabel: auth.user.username,
      action: 'REQUEST_ORDER_RELEASE',
      targetType: 'order',
      targetId: orderId,
      details: {
        orderNo: order.order_no,
        reason,
        paymentVerification: 'unpaid',
        shipmentVerification: 'not_shipped',
        verificationNote,
      },
    });
    const requestRow = await client.query<ReleaseRequestRow>(
      'SELECT * FROM order_release_requests WHERE id = $1',
      [id]
    );
    const fresh = await orderRow(client, 'WHERE o.id = $1', [orderId]);
    const result = {
      order: await buildInternalOrder(client, fresh!),
      request: releaseDto(requestRow.rows[0]),
    };
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

interface ReservationLineAggregate {
  sku_id: string;
  warehouse_id: string;
  quantity: number;
  sku_code: string;
  warehouse_code: string;
}

export async function decideOrderRelease(
  pool: DbPool,
  auth: AuthContext,
  requestId: string,
  input: ReservationDecisionInput
): Promise<{ order: InternalOrderDto; request: ReleaseRequestDto }> {
  requireApprovalPermission(auth, 'orders.approve_release');
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    throw new HttpError(400, 'invalid_decision', 'decision must be APPROVED or REJECTED.');
  }
  const decision = input.decision;
  const expectedVersion = requireReservationVersion(input.expectedReservationVersion);
  const key = requireIdempotencyKey(input.idempotencyKey);
  const note =
    input.note === undefined
      ? ''
      : typeof input.note === 'string'
        ? input.note.trim().slice(0, 1000)
        : (() => {
            throw new HttpError(400, 'invalid_request', 'note must be text.');
          })();
  const digest = actionPayloadDigest('DECIDE_ORDER_RELEASE', {
    requestId,
    decision,
    note,
    expectedReservationVersion: expectedVersion,
  });

  return withTransaction(pool, async client => {
    const pointer = await client.query<{ order_id: string }>(
      'SELECT order_id FROM order_release_requests WHERE id = $1',
      [requestId]
    );
    if (!pointer.rows[0]) {
      throw new HttpError(404, 'release_request_not_found', 'Release request not found.');
    }
    const order = await lockOrderForApproval(client, pointer.rows[0].order_id);
    await assertCurrentSession(client, auth, 'orders.approve_release');
    const scope = {
      operation: 'DECIDE_ORDER_RELEASE',
      actorType: 'internal' as const,
      actorId: auth.user.id,
      orderId: order.id,
      companyId: order.company_id,
      idempotencyKey: key,
      payloadDigest: digest,
    };
    const replayed = await replayIdempotentResult<{
      order: InternalOrderDto;
      request: ReleaseRequestDto;
    }>(client, scope);
    if (replayed) return replayed;

    const requestResult = await client.query<ReleaseRequestRow>(
      'SELECT * FROM order_release_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );
    const request = requestResult.rows[0];
    if (!request) {
      throw new HttpError(404, 'release_request_not_found', 'Release request not found.');
    }
    if (request.status !== 'PENDING') {
      throw new HttpError(409, 'request_already_decided', 'This release request was already decided.');
    }
    if (order.status !== 'CONFIRMED') {
      throw new HttpError(409, 'order_status_conflict', 'Only a confirmed order can be released.');
    }
    const reservation = await loadReservation(client, order.id, true);
    if (reservation.status === 'RELEASED') {
      throw new HttpError(409, 'reservation_released', 'This reservation was already released.');
    }
    if (Number(reservation.reservation_version) !== expectedVersion) {
      throw new HttpError(
        409,
        'reservation_version_conflict',
        'The reservation changed. Review the latest state.'
      );
    }
    if (
      request.payment_verification !== 'unpaid' ||
      request.shipment_verification !== 'not_shipped'
    ) {
      throw new HttpError(
        422,
        'verification_invalid',
        'The release verification is not valid for the ordinary release path.'
      );
    }

    if (decision === 'APPROVED') {
      const lines = await client.query<ReservationLineAggregate>(
        `SELECT sku_id, warehouse_id, SUM(quantity)::int AS quantity,
                min(sku_code) AS sku_code, min(warehouse_code) AS warehouse_code
         FROM order_reservation_lines
         WHERE reservation_id = $1
         GROUP BY sku_id, warehouse_id
         ORDER BY sku_id, warehouse_id`,
        [reservation.id]
      );
      if (!lines.rows.length) {
        throw new HttpError(409, 'reservation_empty', 'The reservation has no lines to release.');
      }
      const skuIds = [...new Set(lines.rows.map(row => row.sku_id))].sort();
      const warehouseIds = [...new Set(lines.rows.map(row => row.warehouse_id))].sort();
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
         ORDER BY sku_id, warehouse_id FOR UPDATE`,
        [skuIds, warehouseIds]
      );
      const balanceByPair = new Map(
        balances.rows.map(row => [`${row.sku_id}:${row.warehouse_id}`, row])
      );
      // Mark this exact request as approved+executed BEFORE the narrow SQL
      // release function runs. The function verifies that record, so a direct
      // SQL caller cannot release stock without an approved execution.
      await client.query(
        `UPDATE order_release_requests
         SET status = 'APPROVED', decided_by_user_id = $2, decided_by_label = $3,
             decided_at = now(), decision_note = $4, executed_at = now()
         WHERE id = $1`,
        [requestId, auth.user.id, auth.user.username, note]
      );
      for (const line of lines.rows) {
        const balance = balanceByPair.get(`${line.sku_id}:${line.warehouse_id}`);
        if (!balance || balance.reserved < line.quantity) {
          throw new HttpError(
            409,
            'reservation_inconsistent',
            `Reserved stock for ${line.sku_code} at ${line.warehouse_code} is lower than the reservation line.`
          );
        }
      }
      for (const line of lines.rows) {
        const balance = balanceByPair.get(`${line.sku_id}:${line.warehouse_id}`)!;
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
             FROM aoking_release_inventory($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              reservation.id,
              order.id,
              requestId,
              line.sku_id,
              line.warehouse_id,
              line.quantity,
              balance.version,
              balance.reserved,
              auth.user.id,
            ]
          );
          applied = result.rows[0];
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (
            message.includes('inventory_conflict') ||
            message.includes('reservation_inconsistent') ||
            message.includes('reservation_line_mismatch') ||
            message.includes('release_not_approved') ||
            message.includes('reservation_already_released')
          ) {
            throw new HttpError(
              409,
              'reservation_inconsistent',
              'Reserved stock no longer matches the reservation. Do not retry blind; reconcile the reservation first.'
            );
          }
          throw new HttpError(
            409,
            'reservation_release_conflict',
            'The reservation could not be released. Reload and retry.'
          );
        }
        await client.query(
          `INSERT INTO inventory_movements
            (id, sku_id, warehouse_id, movement_type, delta_on_hand, delta_unsellable,
             on_hand_before, on_hand_after, unsellable_before, unsellable_after,
             reserved_before, reserved_after, reason, actor_type, actor_id, actor_label)
           VALUES ($1, $2, $3, 'release', 0, 0, $4, $4, $5, $5, $6, $7, $8,
                   'internal', $9, $10)`,
          [
            randomUUID(),
            line.sku_id,
            line.warehouse_id,
            balance.on_hand,
            balance.unsellable,
            applied.reserved_before,
            applied.reserved_after,
            `Order ${order.order_no} approved full release`,
            auth.user.id,
            auth.user.username,
          ]
        );
      }
      await client.query(
        `UPDATE order_reservations
         SET status = 'RELEASED', released_at = now(), released_by_user_id = $2,
             release_reason = $3, reservation_version = reservation_version + 1,
             updated_at = now()
         WHERE id = $1`,
        [reservation.id, auth.user.id, request.reason]
      );
      await client.query(
        `UPDATE orders
         SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2,
             cancellation_kind = 'RELEASE', revision = revision + 1,
             updated_at = now(), customer_visible_note = $3
         WHERE id = $1`,
        [
          order.id,
          request.reason,
          `Order cancelled after an approved full release. Reason: ${request.reason}`,
        ]
      );
      await client.query(
        `INSERT INTO order_status_history
          (id, order_id, event_type, from_status, to_status, actor_type, actor_id,
           actor_label, reason, details)
         VALUES ($1, $2, 'RESERVATION_RELEASED', 'CONFIRMED', 'CANCELLED',
                 'internal', $3, $4, $5, $6)`,
        [
          randomUUID(),
          order.id,
          auth.user.id,
          auth.user.username,
          request.reason,
          {
            requestId,
            reservationId: reservation.id,
            releasedLines: lines.rows.length,
            paymentVerification: request.payment_verification,
            shipmentVerification: request.shipment_verification,
            verifiedByUserId: request.verified_by_user_id,
            verificationNote: request.verification_note,
          },
        ]
      );
      await queueOrderNotifications(client, {
        orderId: order.id,
        companyId: order.company_id,
        companyCode: order.company_code,
        orderNo: order.order_no,
        eventType: 'ORDER_CANCELLED_AFTER_CONFIRMATION',
        customerMessage: `Order ${order.order_no} was cancelled after an approved full release. Reason: ${request.reason}`,
        salesMessage: `Order ${order.order_no} was cancelled after an approved full release.`,
      });
      if (
        order.current_assigned_sales_user_id &&
        order.current_assigned_sales_user_id !== request.requested_by_user_id
      ) {
        await queueInternalNotification(client, {
          orderId: order.id,
          companyId: order.company_id,
          orderNo: order.order_no,
          companyCode: order.company_code,
          eventType: 'RELEASE_DECIDED',
          internalUserId: request.requested_by_user_id,
          title: `Release approved · ${order.order_no}`,
          message: `Your full release request for order ${order.order_no} was approved and executed.`,
        });
      }
      await writeAudit(client, {
        actorType: auth.user.type,
        actorId: auth.user.id,
        actorLabel: auth.user.username,
        action: 'RELEASE_ORDER',
        targetType: 'order',
        targetId: order.id,
        details: {
          orderNo: order.order_no,
          requestId,
          reservationId: reservation.id,
          releasedLines: lines.rows.length,
          requestedByLabel: request.requested_by_label,
          verifiedByUserId: request.verified_by_user_id,
          verificationNote: request.verification_note,
          note,
        },
      });
    } else {
      await client.query(
        `UPDATE order_release_requests
         SET status = 'REJECTED', decided_by_user_id = $2, decided_by_label = $3,
             decided_at = now(), decision_note = $4
         WHERE id = $1`,
        [requestId, auth.user.id, auth.user.username, note]
      );
      await queueInternalNotification(client, {
        orderId: order.id,
        companyId: order.company_id,
        orderNo: order.order_no,
        companyCode: order.company_code,
        eventType: 'RELEASE_DECIDED',
        internalUserId: request.requested_by_user_id,
        title: `Release declined · ${order.order_no}`,
        message: `Your full release request for order ${order.order_no} was declined.`,
      });
      await writeAudit(client, {
        actorType: auth.user.type,
        actorId: auth.user.id,
        actorLabel: auth.user.username,
        action: 'REJECT_ORDER_RELEASE',
        targetType: 'order',
        targetId: order.id,
        details: { orderNo: order.order_no, requestId, note },
      });
    }

    const fresh = await orderRow(client, 'WHERE o.id = $1', [order.id]);
    const requestRow = await client.query<ReleaseRequestRow>(
      'SELECT * FROM order_release_requests WHERE id = $1',
      [requestId]
    );
    const result = {
      order: await buildInternalOrder(client, fresh!),
      request: releaseDto(requestRow.rows[0]),
    };
    await storeIdempotentResult(client, scope, result);
    return result;
  });
}

export interface ExpiryScanResult {
  scanned: number;
  expired: number;
  reminded: number;
  skipped: number;
}

interface ExpiryCandidateRow {
  id: string;
  order_id: string;
  company_id: string;
  expires_at: Date;
}


/**
 * Idempotent, bounded expiry scan. Each reservation is re-read under its row
 * lock so an extension or release that wins the lock is respected. Reminder
 * insertion and notification are in the same transaction, and the unique
 * (reservation_id, deadline_at, kind) key makes repeated/restarted/multi-instance
 * scans emit at most one reminder per real deadline.
 */
export async function runExpiryScan(
  pool: DbPool,
  options: { limit?: number } = {},
  auth?: AuthContext
): Promise<ExpiryScanResult> {
  const limit = Math.min(
    Math.max(1, Number.isInteger(options.limit) ? options.limit! : EXPIRY_SCAN_BATCH),
    500
  );

  return withTransaction(pool, async client => {
    if (auth) {
      await assertCurrentSession(client, auth, 'orders.approve_extension');
    }
    // Business approval only requires an at-expiry reminder. The scan does not
    // send a pre-expiry reminder. Candidate selection is unlocked; each row is
    // then serialized through company -> order -> reservation.
    const candidates = await client.query<{
      id: string;
      order_id: string;
      company_id: string;
      expires_at: Date;
    }>(
      `SELECT id, order_id, company_id, expires_at
       FROM order_reservations
       WHERE status = 'ACTIVE' AND expires_at <= clock_timestamp()
       ORDER BY expires_at, id
       LIMIT $1`,
      [limit]
    );
    let expired = 0;
    let skipped = 0;
    for (const candidate of candidates.rows) {
      const order = await lockOrderForApproval(client, candidate.order_id);
      const reservationResult = await client.query<ReservationRow>(
        'SELECT * FROM order_reservations WHERE id = $1 AND order_id = $2 FOR UPDATE',
        [candidate.id, candidate.order_id]
      );
      const reservation = reservationResult.rows[0];
      if (
        !reservation ||
        reservation.status !== 'ACTIVE' ||
        order.status !== 'CONFIRMED'
      ) {
        skipped += 1;
        continue;
      }
      const now = await dbNow(client);
      if (new Date(reservation.expires_at).getTime() > now.getTime()) {
        skipped += 1;
        continue;
      }
      const reminder = await client.query(
        `INSERT INTO order_deadline_reminders
          (id, reservation_id, order_id, deadline_at, kind)
         VALUES ($1, $2, $3, $4, 'EXPIRED')
         ON CONFLICT (reservation_id, deadline_at, kind) DO NOTHING`,
        [randomUUID(), reservation.id, order.id, reservation.expires_at]
      );
      if (reminder.rowCount !== 1) {
        skipped += 1;
        continue;
      }
      {
        await client.query(
          `UPDATE order_reservations
           SET status = 'EXPIRED', updated_at = now()
           WHERE id = $1 AND status = 'ACTIVE'`,
          [reservation.id]
        );
        await client.query(
          `INSERT INTO order_status_history
            (id, order_id, event_type, from_status, to_status, actor_type, actor_label,
             reason, details)
           VALUES ($1, $2, 'RESERVATION_EXPIRED', 'CONFIRMED', 'CONFIRMED',
                   'system', 'expiry-scan', '', $3)`,
          [
            randomUUID(),
            order.id,
            {
              reservationId: reservation.id,
              deadlineAt: new Date(reservation.expires_at).toISOString(),
            },
          ]
        );
        if (order.current_assigned_sales_user_id) {
          await queueInternalNotification(client, {
            orderId: order.id,
            companyId: order.company_id,
            orderNo: order.order_no,
            companyCode: order.company_code,
            eventType: 'RESERVATION_EXPIRED',
            internalUserId: order.current_assigned_sales_user_id,
            title: `Reservation expired · ${order.order_no}`,
            message: `The reservation for order ${order.order_no} expired. Stock remains held for an audited decision.`,
          });
        }
        await queueBusinessAdminNotifications(client, {
          orderId: order.id,
          companyId: order.company_id,
          orderNo: order.order_no,
          companyCode: order.company_code,
          eventType: 'RESERVATION_EXPIRED',
          title: `Overdue reservation · ${order.order_no}`,
          message: `Reservation ${order.order_no} is overdue. Stock is still held; extend or release it explicitly.`,
          permission: 'orders.approve_extension',
        });
        await writeAudit(client, {
          actorType: 'system',
          actorLabel: 'expiry-scan',
          action: 'EXPIRE_RESERVATION',
          targetType: 'order',
          targetId: order.id,
          details: {
            orderNo: order.order_no,
            reservationId: reservation.id,
            deadlineAt: new Date(reservation.expires_at).toISOString(),
          },
        });
        expired += 1;
      }
    }
    return { scanned: candidates.rows.length, expired, reminded: 0, skipped };
  });
}

export interface ReservationReconciliationRow {
  skuId: string;
  warehouseId: string;
  skuCode: string;
  warehouseCode: string;
  reserved: number;
  expectedReserved: number;
}

/**
 * Operational reconciliation: the aggregate `reserved` must equal the sum of
 * lines on reservations that still hold stock (ACTIVE or EXPIRED). Released
 * reservations no longer contribute.
 */
export async function reconcileReservations(
  pool: DbPool
): Promise<ReservationReconciliationRow[]> {
  const result = await pool.query<{
    sku_id: string;
    warehouse_id: string;
    sku_code: string;
    warehouse_code: string;
    reserved: number;
    expected_reserved: string;
  }>(
    `SELECT b.sku_id, b.warehouse_id, s.sku_code, w.code AS warehouse_code,
            b.reserved, COALESCE(held.quantity, 0)::text AS expected_reserved
     FROM inventory_balances b
     JOIN product_skus s ON s.id = b.sku_id
     JOIN warehouses w ON w.id = b.warehouse_id
     LEFT JOIN (
       SELECT rl.sku_id, rl.warehouse_id, SUM(rl.quantity)::int AS quantity
       FROM order_reservation_lines rl
       JOIN order_reservations r ON r.id = rl.reservation_id
       WHERE r.status IN ('ACTIVE', 'EXPIRED')
       GROUP BY rl.sku_id, rl.warehouse_id
     ) held ON held.sku_id = b.sku_id AND held.warehouse_id = b.warehouse_id
     WHERE b.reserved <> COALESCE(held.quantity, 0)
     ORDER BY b.sku_id, b.warehouse_id`
  );
  return result.rows.map(row => ({
    skuId: row.sku_id,
    warehouseId: row.warehouse_id,
    skuCode: row.sku_code,
    warehouseCode: row.warehouse_code,
    reserved: row.reserved,
    expectedReserved: Number(row.expected_reserved),
  }));
}
