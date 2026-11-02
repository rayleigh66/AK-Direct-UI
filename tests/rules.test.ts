import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SKU_MOQ,
  applyReservationAllocations,
  calculateEffectiveUnitPrice,
  calculateSKUAvailableStock,
  consumeReservationAllocations,
  evaluateCustomerTier,
  legacyReservationAllocations,
  planOrderReservation,
  releaseReservationAllocations,
  validateSKUQuantity,
} from '../src/utils/rules';
import { INITIAL_PROMOTIONS, INITIAL_TIER_RULES } from '../src/data/mockData';
import type { InventoryBalance, Promotion } from '../src/types';

const promo = (overrides: Partial<Promotion> = {}): Promotion => ({
  id: 'promo-test',
  sku_id: 'sku-test',
  promo_price_usd: 80,
  start_at: '2026-10-15',
  end_at: '2026-11-30',
  stack_tier_discount: false,
  status: 'active',
  ...overrides,
});

const balance = (
  warehouse_id: string,
  on_hand: number,
  reserved = 0,
  unsellable = 0,
  sku_id = 'sku-test'
): InventoryBalance => ({
  warehouse_id,
  sku_id,
  on_hand,
  reserved,
  unsellable,
  updated_at: '2026-11-01',
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MOQ', () => {
  it('requires whole PCS at or above 10', () => {
    expect(SKU_MOQ).toBe(10);
    expect(validateSKUQuantity(9)).toMatchObject({ valid: false });
    expect(validateSKUQuantity(10)).toEqual({ valid: true });
    expect(validateSKUQuantity(10.5)).toMatchObject({ valid: false });
    expect(validateSKUQuantity(Number.NaN)).toMatchObject({ valid: false });
    expect(validateSKUQuantity(-10)).toMatchObject({ valid: false });
  });
});

describe('promotion effective dates', () => {
  it('uses the injected date and respects stack rules', () => {
    expect(
      calculateEffectiveUnitPrice(100, 'sku-test', 0.1, [promo()], '2026-11-01').effectivePrice
    ).toBe(80);
    expect(
      calculateEffectiveUnitPrice(100, 'sku-test', 0.1, [promo()], '2026-10-01').effectivePrice
    ).toBe(90);
    expect(
      calculateEffectiveUnitPrice(
        100,
        'sku-test',
        0.1,
        [promo({ stack_tier_discount: true })],
        '2026-11-01'
      ).effectivePrice
    ).toBe(72);
    expect(
      calculateEffectiveUnitPrice(
        100,
        'sku-test',
        0.1,
        [promo({ status: 'expired' })],
        '2026-11-01'
      ).isPromo
    ).toBe(false);
    expect(
      calculateEffectiveUnitPrice(100, 'sku-test', 0.1, [promo()], '2026-11-30').isPromo
    ).toBe(true);
    expect(
      calculateEffectiveUnitPrice(100, 'sku-test', 0.1, [promo()], '2026-12-01').isPromo
    ).toBe(false);
  });

  it('defaults to the actual current date instead of a hardcoded date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    expect(calculateEffectiveUnitPrice(55, 'sku-7710-gld', 0, INITIAL_PROMOTIONS).isPromo).toBe(
      true
    );
    vi.setSystemTime(new Date('2026-12-01T12:00:00Z'));
    expect(calculateEffectiveUnitPrice(55, 'sku-7710-gld', 0, INITIAL_PROMOTIONS).isPromo).toBe(
      false
    );
  });
});

describe('customer tier', () => {
  it('uses thresholds and applies inactivity downgrades with a Tier 1 floor', () => {
    expect(evaluateCustomerTier(0, 0, INITIAL_TIER_RULES).currentTier.tier_level).toBe(1);
    expect(evaluateCustomerTier(9999, 0, INITIAL_TIER_RULES).currentTier.tier_level).toBe(1);
    expect(evaluateCustomerTier(10000, 0, INITIAL_TIER_RULES).currentTier.tier_level).toBe(2);
    expect(evaluateCustomerTier(50000, 0, INITIAL_TIER_RULES).currentTier.tier_level).toBe(3);
    expect(evaluateCustomerTier(350000, 0, INITIAL_TIER_RULES).currentTier.tier_level).toBe(5);

    expect(evaluateCustomerTier(18500, 17, INITIAL_TIER_RULES).downgradeCount).toBe(0);
    expect(evaluateCustomerTier(18500, 18, INITIAL_TIER_RULES).downgradeCount).toBe(1);
    expect(evaluateCustomerTier(18500, 30, INITIAL_TIER_RULES).downgradeCount).toBe(2);

    const oneDowngrade = evaluateCustomerTier(18500, 26, INITIAL_TIER_RULES);
    expect(oneDowngrade.baseTier.tier_level).toBe(2);
    expect(oneDowngrade.downgradeCount).toBe(1);
    expect(oneDowngrade.currentTier.tier_level).toBe(1);

    const floor = evaluateCustomerTier(18500, 42, INITIAL_TIER_RULES);
    expect(floor.downgradeCount).toBe(3);
    expect(floor.currentTier.tier_level).toBe(1);
  });

  it('computes next-tier gap without changing the base tier for inactivity', () => {
    const result = evaluateCustomerTier(68400, 6, INITIAL_TIER_RULES);
    expect(result.baseTier.tier_level).toBe(3);
    expect(result.nextTier?.tier_level).toBe(4);
    expect(result.spendGapToNextTier).toBe(150000 - 68400);
  });
});

describe('multi-warehouse availability and reservation', () => {
  it('aggregates available stock across warehouses', () => {
    const result = calculateSKUAvailableStock('sku-test', [
      balance('wh-sh', 160, 20, 0),
      balance('wh-gz', 90, 0, 5),
    ]);
    expect(result).toEqual({
      totalAvailable: 225,
      totalOnHand: 250,
      totalReserved: 20,
      totalUnsellable: 5,
    });
  });

  it('allocates a reservation across warehouses deterministically', () => {
    const plan = planOrderReservation(
      [{ sku_id: 'sku-test', quantity: 12 }],
      [balance('wh-gz', 5), balance('wh-sh', 10)]
    );
    expect(plan).toEqual({
      success: true,
      allocations: [
        { sku_id: 'sku-test', warehouse_id: 'wh-gz', quantity: 5 },
        { sku_id: 'sku-test', warehouse_id: 'wh-sh', quantity: 7 },
      ],
    });
  });

  it('fails the whole order when one SKU is short and returns no partial allocation', () => {
    const plan = planOrderReservation(
      [
        { sku_id: 'sku-a', quantity: 10 },
        { sku_id: 'sku-b', quantity: 11 },
      ],
      [balance('wh-sh', 100, 0, 0, 'sku-a'), balance('wh-sh', 10, 0, 0, 'sku-b')]
    );
    expect(plan).toEqual({
      success: false,
      sku_id: 'sku-b',
      required: 11,
      available: 10,
    });
  });

  it('aggregates duplicate SKU lines before allocating', () => {
    const plan = planOrderReservation(
      [
        { sku_id: 'sku-test', quantity: 6 },
        { sku_id: 'sku-test', quantity: 6 },
      ],
      [balance('wh-sh', 20)]
    );
    expect(plan).toEqual({
      success: true,
      allocations: [{ sku_id: 'sku-test', warehouse_id: 'wh-sh', quantity: 12 }],
    });
  });

  it('applies, releases and consumes only the recorded warehouse allocations', () => {
    const balances = [balance('wh-sh', 20), balance('wh-gz', 20)];
    const allocations = [
      { sku_id: 'sku-test', warehouse_id: 'wh-gz', quantity: 8 },
      { sku_id: 'sku-test', warehouse_id: 'wh-sh', quantity: 4 },
    ];
    const reserved = applyReservationAllocations(balances, allocations);
    expect(reserved).not.toBeNull();
    expect(reserved!.find((item) => item.warehouse_id === 'wh-gz')?.reserved).toBe(8);
    expect(reserved!.find((item) => item.warehouse_id === 'wh-sh')?.reserved).toBe(4);

    const released = releaseReservationAllocations(reserved!, allocations);
    expect(released.every((item) => item.reserved === 0)).toBe(true);

    const consumed = consumeReservationAllocations(reserved!, allocations);
    expect(consumed.find((item) => item.warehouse_id === 'wh-gz')).toMatchObject({
      on_hand: 12,
      reserved: 0,
    });
    expect(consumed.find((item) => item.warehouse_id === 'wh-sh')).toMatchObject({
      on_hand: 16,
      reserved: 0,
    });
  });

  it('rejects an application when the planned stock no longer fits', () => {
    expect(
      applyReservationAllocations(
        [balance('wh-sh', 10, 5)],
        [{ sku_id: 'sku-test', warehouse_id: 'wh-sh', quantity: 6 }]
      )
    ).toBeNull();
    expect(
      applyReservationAllocations(
        [balance('wh-sh', 10)],
        [{ sku_id: 'sku-test', warehouse_id: 'missing', quantity: 1 }]
      )
    ).toBeNull();
  });

  it('finds legacy reserved stock for pre-allocation orders', () => {
    expect(
      legacyReservationAllocations(
        [{ sku_id: 'sku-test', quantity: 12 }],
        [balance('wh-sh', 20, 10), balance('wh-gz', 20, 5)]
      )
    ).toEqual([
      { sku_id: 'sku-test', warehouse_id: 'wh-gz', quantity: 5 },
      { sku_id: 'sku-test', warehouse_id: 'wh-sh', quantity: 7 },
    ]);
  });
});
