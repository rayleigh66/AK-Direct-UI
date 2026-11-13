import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';

export interface IdempotencyScope {
  operation: string;
  actorType: 'customer' | 'internal';
  actorId: string;
  orderId: string | null;
  companyId: string;
  /** Set for customer acceptance so a re-granted instance cannot replay. */
  authorizationId?: string | null;
  idempotencyKey: string;
  payloadDigest: string;
}

interface IdempotencyRow {
  order_id: string | null;
  company_id: string;
  authorization_id: string | null;
  payload_digest: string;
  result: unknown;
}

function conflict(): HttpError {
  return new HttpError(
    409,
    'idempotency_conflict',
    'This idempotency key was already used for a different action, order, company or payload.'
  );
}

/**
 * Replay lookup. Call this only after the current transaction has authenticated
 * the actor and established the order/company scope (for example after the
 * company/order locks), but before revision/state checks. A successful retry of
 * an already-completed action therefore returns its first safe result.
 */
export async function replayIdempotentResult<T>(
  client: PoolClient,
  scope: IdempotencyScope
): Promise<T | null> {
  const existing = await client.query<IdempotencyRow>(
    `SELECT order_id, company_id, authorization_id, payload_digest, result
     FROM order_action_idempotency
     WHERE operation = $1 AND actor_id = $2 AND idempotency_key = $3`,
    [scope.operation, scope.actorId, scope.idempotencyKey]
  );
  const row = existing.rows[0];
  if (!row) return null;
  if (
    row.order_id !== scope.orderId ||
    row.company_id !== scope.companyId ||
    (row.authorization_id ?? null) !== (scope.authorizationId ?? null) ||
    row.payload_digest !== scope.payloadDigest
  ) {
    throw conflict();
  }
  return row.result as T;
}

/**
 * Store the first successful result in the same transaction as the state
 * change. A concurrent insert with the same key is re-read and compared; a
 * different payload/scope is rejected instead of leaking the other result.
 */
export async function storeIdempotentResult<T>(
  client: PoolClient,
  scope: IdempotencyScope,
  result: T
): Promise<T> {
  const inserted = await client.query(
    `INSERT INTO order_action_idempotency
      (id, operation, actor_type, actor_id, order_id, company_id,
       authorization_id, idempotency_key, payload_digest, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (operation, actor_id, idempotency_key) DO NOTHING`,
    [
      randomUUID(),
      scope.operation,
      scope.actorType,
      scope.actorId,
      scope.orderId,
      scope.companyId,
      scope.authorizationId ?? null,
      scope.idempotencyKey,
      scope.payloadDigest,
      JSON.stringify(result),
    ]
  );
  if (inserted.rowCount === 1) return result;
  const existing = await client.query<IdempotencyRow>(
    `SELECT order_id, company_id, authorization_id, payload_digest, result
     FROM order_action_idempotency
     WHERE operation = $1 AND actor_id = $2 AND idempotency_key = $3`,
    [scope.operation, scope.actorId, scope.idempotencyKey]
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.order_id !== scope.orderId ||
    row.company_id !== scope.companyId ||
    (row.authorization_id ?? null) !== (scope.authorizationId ?? null) ||
    row.payload_digest !== scope.payloadDigest
  ) {
    throw conflict();
  }
  return row.result as T;
}
