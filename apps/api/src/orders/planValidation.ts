import { createHash } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { MAX_PRICE_CENTS } from './validation.js';

export interface PlanLineForDigest {
  lineNumber: number;
  skuId: string;
  quantity: number;
  referenceUnitPriceCents: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Stable JSON with sorted object keys. Used only for idempotency-input
 * comparison, never for money or authorization decisions.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

export function actionPayloadDigest(operation: string, payload: unknown): string {
  return sha256(`aoking-direct:4b05:${operation}:${canonicalJson(payload)}`);
}

/**
 * Full customer-acceptance digest. It covers the current plan version, every
 * line's quantity, reference price and final price, and the recomputed line
 * total, in canonical line-number order. It deliberately excludes internal
 * warehouse allocation and approver identities.
 */
export function planDigest(
  orderId: string,
  planVersion: number,
  lines: PlanLineForDigest[]
): string {
  const normalized = [...lines]
    .sort((left, right) => left.lineNumber - right.lineNumber)
    .map(line => [
      line.lineNumber,
      line.skuId,
      line.quantity,
      line.referenceUnitPriceCents,
      line.unitPriceCents,
      line.lineTotalCents,
    ]);
  return sha256(
    `aoking-direct:4b05:plan|${orderId}|${planVersion}|${JSON.stringify(normalized)}`
  );
}

/**
 * Domain-separated price fingerprint. It is stable for a quantity-only change
 * because quantity is deliberately absent, and it changes for every manual
 * unit-price change in either direction.
 */
export function priceFingerprint(
  orderId: string,
  lines: Array<{
    skuId: string;
    referenceUnitPriceCents: number;
    unitPriceCents: number;
  }>
): string {
  const normalized = [...lines]
    .sort((left, right) => left.skuId.localeCompare(right.skuId))
    .map(line => [
      line.skuId,
      line.referenceUnitPriceCents,
      line.unitPriceCents,
    ]);
  return sha256(`aoking-direct:4b05:price|${orderId}|${JSON.stringify(normalized)}`);
}

export function validateUnitPrice(value: unknown, field = 'unitPriceCents'): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_PRICE_CENTS
  ) {
    throw new HttpError(
      400,
      'invalid_unit_price',
      `${field} must be a positive whole number of USD cents no greater than ${MAX_PRICE_CENTS}.`
    );
  }
  return value;
}

export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_idempotency_key', 'idempotencyKey is required.');
  }
  const key = value.trim();
  if (key.length < 8 || key.length > 128) {
    throw new HttpError(
      400,
      'invalid_idempotency_key',
      'idempotencyKey must contain between 8 and 128 characters.'
    );
  }
  return key;
}

export function requirePlanVersion(value: unknown, field = 'expectedPlanVersion'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'invalid_plan_version', `${field} must be a non-negative whole number.`);
  }
  return value;
}

export function requireReservationVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new HttpError(
      400,
      'invalid_reservation_version',
      'expectedReservationVersion must be a positive whole number.'
    );
  }
  return value;
}
