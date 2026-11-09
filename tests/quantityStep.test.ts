import { describe, expect, it } from 'vitest';
import { stepQuantity } from '../src/utils/quantity';

describe('stepQuantity', () => {
  it('steps one whole PCS inside MOQ and stock boundaries', () => {
    expect(stepQuantity('10', 1, 10, 23)).toBe('11');
    expect(stepQuantity('12', -1, 10, 23)).toBe('11');
    expect(stepQuantity(15, 1, 10, 23)).toBe('16');
  });

  it('clamps at the MOQ and the stock maximum', () => {
    expect(stepQuantity('10', -1, 10, 23)).toBe('10');
    expect(stepQuantity('23', 1, 10, 23)).toBe('23');
    expect(stepQuantity('5', 1, 10, 23)).toBe('10');
  });

  it('treats empty or invalid drafts as the minimum before stepping', () => {
    expect(stepQuantity('', 1, 10, 23)).toBe('10');
    expect(stepQuantity('abc', -1, 10, 23)).toBe('10');
  });

  it('rounds fractional input and works without a maximum', () => {
    expect(stepQuantity('12.6', 0, 10, 23)).toBe('13');
    expect(stepQuantity('10', 1, 10)).toBe('11');
  });

  it('keeps the minimum when the maximum is below it', () => {
    expect(stepQuantity('10', 1, 10, 4)).toBe('10');
  });
});
