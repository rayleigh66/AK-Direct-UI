// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp } from '../src/context/AppContext';
import {
  calculateEffectiveUnitPrice,
  validateDiscountRate,
  validateOrderAmount,
  validateUnitPrice,
} from '../src/utils/rules';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);
const setup = () => renderHook(() => useApp(), { wrapper });

afterEach(cleanup);

describe('pricing integrity', () => {
  it('rejects 150% and negative discounts at the admin configuration entry', () => {
    const { result } = setup();
    act(() => {
      result.current.switchRole('admin');
    });
    const before = result.current.tierRules.find(tier => tier.id === 'tier-3')!;
    expect(before.discount_rate).toBe(0.1);

    act(() => {
      const tooHigh = result.current.adminUpdateTierRule('tier-3', before.threshold_usd, 1.5);
      expect(tooHigh.success).toBe(false);
      expect(tooHigh.error).toMatch(/exceed 100%/i);
      const negative = result.current.adminUpdateTierRule('tier-3', before.threshold_usd, -0.1);
      expect(negative.success).toBe(false);
      expect(negative.error).toMatch(/negative/i);
      const nonFinite = result.current.adminUpdateTierRule('tier-3', Number.NaN, 0.1);
      expect(nonFinite.success).toBe(false);
      expect(nonFinite.error).toMatch(/finite/i);
      const negativeThreshold = result.current.adminUpdateTierRule('tier-3', -1, 0.1);
      expect(negativeThreshold.success).toBe(false);
      expect(negativeThreshold.error).toMatch(/non-negative/i);
    });

    const after = result.current.tierRules.find(tier => tier.id === 'tier-3')!;
    expect(after).toEqual(before);
  });

  it('rejects invalid promotion prices without changing the promotion list', () => {
    const { result } = setup();
    act(() => {
      result.current.switchRole('admin');
    });
    const count = result.current.promotions.length;
    act(() => {
      expect(
        result.current.adminAddOrUpdatePromotion({
          sku_id: 'sku-9042-blk',
          promo_price_usd: 0,
          start_at: '2026-11-01',
          end_at: '2026-12-01',
          stack_tier_discount: false,
          status: 'active',
        }).success
      ).toBe(false);
      expect(
        result.current.adminAddOrUpdatePromotion({
          sku_id: 'sku-9042-blk',
          promo_price_usd: -5,
          start_at: '2026-11-01',
          end_at: '2026-12-01',
          stack_tier_discount: false,
          status: 'active',
        }).success
      ).toBe(false);
      expect(
        result.current.adminAddOrUpdatePromotion({
          sku_id: 'sku-9042-blk',
          promo_price_usd: Number.POSITIVE_INFINITY,
          start_at: '2026-11-01',
          end_at: '2026-12-01',
          stack_tier_discount: false,
          status: 'active',
        }).success
      ).toBe(false);
    });
    expect(result.current.promotions).toHaveLength(count);
  });

  it('keeps the shared price calculation finite and non-negative', () => {
    expect(calculateEffectiveUnitPrice(38, 'sku-9042-blk', 0.1, []).effectivePrice).toBe(34.2);
    expect(() => calculateEffectiveUnitPrice(38, 'sku-9042-blk', 1.5, [])).toThrow(
      /exceed 100%/i
    );
    expect(() => calculateEffectiveUnitPrice(38, 'sku-9042-blk', -0.1, [])).toThrow(/negative/i);
    expect(() => calculateEffectiveUnitPrice(Number.NaN, 'sku-9042-blk', 0.1, [])).toThrow(
      /finite/i
    );
    expect(() =>
      calculateEffectiveUnitPrice(38, 'sku-9042-blk', 0.1, [
        {
          id: 'promo-invalid',
          sku_id: 'sku-9042-blk',
          promo_price_usd: 0,
          start_at: '2026-11-01',
          end_at: '2026-12-01',
          stack_tier_discount: false,
          status: 'active',
        },
      ])
    ).toThrow(/greater than 0/i);
    expect(validateDiscountRate(1).valid).toBe(true);
    expect(validateUnitPrice(0).valid).toBe(false);
    expect(validateOrderAmount(-0.01).valid).toBe(false);
    expect(validateOrderAmount(0).valid).toBe(true);
  });

  it('rejects admin pricing operations from customer and sales roles', () => {
    const { result } = setup();
    const before = result.current.tierRules.find(tier => tier.id === 'tier-3')!;
    act(() => {
      expect(result.current.adminUpdateTierRule('tier-3', 50000, 0.2).success).toBe(false);
      expect(
        result.current.adminAddOrUpdatePromotion({
          sku_id: 'sku-9042-blk',
          promo_price_usd: 20,
          start_at: '2026-11-01',
          end_at: '2026-12-01',
          stack_tier_discount: false,
          status: 'active',
        }).success
      ).toBe(false);
      result.current.switchRole('sales');
      expect(result.current.adminUpdateTierRule('tier-3', 50000, 0.2).success).toBe(false);
    });
    expect(result.current.tierRules.find(tier => tier.id === 'tier-3')).toEqual(before);
  });
});
