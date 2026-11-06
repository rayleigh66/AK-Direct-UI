import { describe, expect, it } from 'vitest';
import {
  MAX_ORDER_TOTAL_CENTS,
  checkPrivacyViolations,
  formatOrderNumber,
  multiplyCents,
  orderBusinessDate,
  orderNumberDatePart,
  orderPayloadDigest,
  sumCents,
  validateDelivery,
  validateOrderQuantity,
} from '../../src/orders/validation.js';

const delivery = {
  shippingMethod: 'Sea',
  destinationCountryAlpha3: 'USA',
  expectedShipDate: '2026-12-15',
  shippingRequirements: 'Standard export cartons with pallet wrap.',
};

describe('order delivery validation', () => {
  it('accepts the frozen delivery fields and normalises the country code', () => {
    expect(validateDelivery({ ...delivery, destinationCountryAlpha3: ' usa ' })).toEqual({
      shippingMethod: 'Sea',
      destinationCountryAlpha3: 'USA',
      expectedShipDate: '2026-12-15',
      shippingRequirements: 'Standard export cartons with pallet wrap.',
    });
  });

  it('rejects unknown methods, unassigned countries and impossible dates', () => {
    expect(() => validateDelivery({ ...delivery, shippingMethod: 'Teleport' })).toThrow(
      /shippingMethod/
    );
    expect(() =>
      validateDelivery({ ...delivery, destinationCountryAlpha3: 'ZZZ' })
    ).toThrow(/alpha-3/);
    expect(() =>
      validateDelivery({ ...delivery, expectedShipDate: '2026-02-30' })
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      validateDelivery({ ...delivery, expectedShipDate: '15/12/2026' })
    ).toThrow(/YYYY-MM-DD/);
  });

  it('rejects contact and address details in free text', () => {
    expect(checkPrivacyViolations('Call +1 555 123 4567').hasViolation).toBe(true);
    expect(checkPrivacyViolations('Email buyer@example.com').hasViolation).toBe(true);
    expect(checkPrivacyViolations('Deliver to 12 Main Street').hasViolation).toBe(true);
    expect(checkPrivacyViolations('Fumigation-free pallet').hasViolation).toBe(false);
    expect(() =>
      validateDelivery({ ...delivery, shippingRequirements: 'Phone 555 123 4567' })
    ).toThrow(/phone/i);
  });

  it('enforces integer-cent amounts and MOQ', () => {
    expect(multiplyCents(3800, 10)).toBe(38000);
    expect(sumCents([38000, 42000])).toBe(80000);
    expect(() => multiplyCents(100_000_000, 1_000_000)).toThrow(/amount/);
    expect(() => sumCents([MAX_ORDER_TOTAL_CENTS, 1])).toThrow(/amount/);
    expect(validateOrderQuantity(10)).toBe(10);
    expect(() => validateOrderQuantity(9)).toThrow(/10/);
    expect(() => validateOrderQuantity(10.5)).toThrow(/whole number/);
  });

  it('builds deterministic business order numbers in a configured time zone', () => {
    const instant = new Date('2026-11-05T23:30:00.000Z');
    expect(orderNumberDatePart(instant, 'UTC')).toBe('261105');
    expect(orderBusinessDate(instant, 'UTC')).toBe('2026-11-05');
    expect(orderNumberDatePart(instant, 'Asia/Shanghai')).toBe('261106');
    expect(orderBusinessDate(instant, 'Asia/Shanghai')).toBe('2026-11-06');
    expect(formatOrderNumber('261105', 1)).toBe('OD2611050001');
    expect(formatOrderNumber('261105', 9999)).toBe('OD2611059999');
    expect(() => formatOrderNumber('261105', 10000)).toThrow(/order number/i);
  });

  it('canonicalises the submit payload for idempotency', () => {
    const first = orderPayloadDigest(delivery, 7);
    const reordered = orderPayloadDigest(
      {
        shippingRequirements: delivery.shippingRequirements,
        expectedShipDate: delivery.expectedShipDate,
        destinationCountryAlpha3: delivery.destinationCountryAlpha3,
        shippingMethod: delivery.shippingMethod,
      },
      7
    );
    expect(first).toBe(reordered);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(orderPayloadDigest(delivery, 8)).not.toBe(first);
    expect(orderPayloadDigest({ ...delivery, shippingMethod: 'Air' }, 7)).not.toBe(first);
  });
});
