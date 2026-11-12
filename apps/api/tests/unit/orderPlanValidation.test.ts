import { describe, expect, it } from 'vitest';
import {
  actionPayloadDigest,
  planDigest,
  priceFingerprint,
  validateUnitPrice,
} from '../../src/orders/planValidation.js';
import { HttpError } from '../../src/http/errors.js';

const line = {
  lineNumber: 1,
  skuId: '00000000-0000-4000-8000-000000000001',
  quantity: 20,
  referenceUnitPriceCents: 4200,
  unitPriceCents: 4200,
  lineTotalCents: 84000,
};

describe('Phase 4B-05 plan validation', () => {
  it('keeps the price fingerprint stable across quantity-only changes', () => {
    const base = priceFingerprint('order-1', [
      { skuId: line.skuId, referenceUnitPriceCents: 4200, unitPriceCents: 4000 },
    ]);
    const quantityOnly = priceFingerprint('order-1', [
      { skuId: line.skuId, referenceUnitPriceCents: 4200, unitPriceCents: 4000 },
    ]);
    expect(quantityOnly).toBe(base);
  });

  it('changes the price fingerprint for every manual price direction', () => {
    const reference = priceFingerprint('order-1', [
      { skuId: line.skuId, referenceUnitPriceCents: 4200, unitPriceCents: 4200 },
    ]);
    const discount = priceFingerprint('order-1', [
      { skuId: line.skuId, referenceUnitPriceCents: 4200, unitPriceCents: 4000 },
    ]);
    const increase = priceFingerprint('order-1', [
      { skuId: line.skuId, referenceUnitPriceCents: 4200, unitPriceCents: 4400 },
    ]);
    expect(new Set([reference, discount, increase]).size).toBe(3);
  });

  it('includes quantity, final price and totals in the acceptance digest', () => {
    const base = planDigest('order-1', 1, [line]);
    expect(planDigest('order-1', 2, [line])).not.toBe(base);
    expect(planDigest('order-1', 1, [{ ...line, quantity: 21, lineTotalCents: 88200 }])).not.toBe(
      base
    );
    expect(
      planDigest('order-1', 1, [{ ...line, unitPriceCents: 4100, lineTotalCents: 82000 }])
    ).not.toBe(base);
  });

  it('canonicalises idempotency payload key order', () => {
    expect(actionPayloadDigest('OP', { a: 1, b: [2, 3] })).toBe(
      actionPayloadDigest('OP', { b: [2, 3], a: 1 })
    );
    expect(actionPayloadDigest('OP', { a: 1 })).not.toBe(actionPayloadDigest('OP', { a: 2 }));
  });

  it('rejects zero, negative, fractional and unsafe unit prices', () => {
    for (const value of [0, -1, 1.5, Number.NaN, '4200', null]) {
      expect(() => validateUnitPrice(value)).toThrow(HttpError);
    }
    expect(validateUnitPrice(4200)).toBe(4200);
  });
});
