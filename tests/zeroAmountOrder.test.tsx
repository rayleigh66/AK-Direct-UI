// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp } from '../src/context/AppContext';
import {
  validateConfirmableOrderTotal,
  validateOrderAmount,
} from '../src/utils/rules';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);
const setup = () => renderHook(() => useApp(), { wrapper });
const as = (result: { current: ReturnType<typeof useApp> }, role: 'customer' | 'sales' | 'admin') => {
  act(() => {
    result.current.switchRole(role, role === 'customer' ? 'user-001a' : undefined);
  });
};
const shipping = {
  shippingMethod: 'Sea' as const,
  destinationCountryAlpha3: 'USA',
  expectedShipDate: '2026-12-15',
  shippingRequirements: 'Standard export carton.',
};

const setTierDiscount = (result: { current: ReturnType<typeof useApp> }, rate: number) => {
  as(result, 'admin');
  act(() => {
    expect(result.current.adminUpdateTierRule('tier-3', 50000, rate).success).toBe(true);
  });
};

const createOrder = (result: { current: ReturnType<typeof useApp> }) => {
  as(result, 'customer');
  act(() => {
    expect(result.current.addToCart('sku-9042-blk', 10).success).toBe(true);
  });
  act(() => {
    expect(result.current.submitOrder(shipping).success).toBe(true);
  });
  return result.current.orders[0];
};

const orderById = (result: { current: ReturnType<typeof useApp> }, id: string) =>
  result.current.orders.find(order => order.id === id)!;

const stateSnapshot = (result: { current: ReturnType<typeof useApp> }) => ({
  orders: JSON.stringify(result.current.orders),
  inventory: JSON.stringify(result.current.inventory),
  notifications: JSON.stringify(result.current.notifications),
  emails: JSON.stringify(result.current.internalEmailTemplates),
  audit: JSON.stringify(result.current.auditLogs),
  confirmAudits: result.current.auditLogs.filter(entry => entry.action === 'CONFIRM_ORDER')
    .length,
});

afterEach(cleanup);

describe('zero-amount order confirmation guard', () => {
  it('rejects confirmation of a 100%-discount zero-total PENDING order without side effects', () => {
    const { result } = setup();
    setTierDiscount(result, 1);
    const order = createOrder(result);
    expect(order.status).toBe('PENDING_CONFIRMATION');
    expect(order.total_quoted_usd).toBe(0);

    as(result, 'sales');
    const before = stateSnapshot(result);
    const rejected = result.current.salesConfirmOrder(order.id);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toMatch(/USD \$0\.00/);
    expect(rejected.error).toMatch(/暂不允许确认或预占库存/);

    expect(stateSnapshot(result)).toEqual(before);
    const unchanged = orderById(result, order.id);
    expect(unchanged.status).toBe('PENDING_CONFIRMATION');
    expect(unchanged.total_confirmed_usd).toBeUndefined();
    expect(unchanged.reservation_expires_at).toBeUndefined();
    expect(unchanged.reservation_allocations).toBeUndefined();
  });

  it('rejects a legal high discount whose total rounds to USD $0.00', () => {
    const { result } = setup();
    setTierDiscount(result, 0.9999);
    const order = createOrder(result);
    expect(order.total_quoted_usd).toBe(0);

    as(result, 'sales');
    const before = stateSnapshot(result);
    const rejected = result.current.salesConfirmOrder(order.id);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toMatch(/USD \$0\.00/);

    expect(stateSnapshot(result)).toEqual(before);
    expect(orderById(result, order.id).status).toBe('PENDING_CONFIRMATION');
  });

  it('keeps the order and inventory unchanged across repeated zero-amount attempts', async () => {
    const { result } = setup();
    setTierDiscount(result, 1);
    const order = createOrder(result);
    as(result, 'sales');
    const before = stateSnapshot(result);

    let first: { success: boolean; error?: string } | undefined;
    let second: { success: boolean; error?: string } | undefined;
    act(() => {
      first = result.current.salesConfirmOrder(order.id);
    });
    await Promise.resolve();
    act(() => {
      second = result.current.salesConfirmOrder(order.id);
    });

    expect(first?.success).toBe(false);
    expect(second?.success).toBe(false);
    expect(first?.error).toMatch(/USD \$0\.00/);
    expect(second?.error).toMatch(/USD \$0\.00/);
    expect(stateSnapshot(result)).toEqual(before);
    expect(orderById(result, order.id).status).toBe('PENDING_CONFIRMATION');
  });

  it('still confirms, reserves, pays and ships a normal positive-total order', () => {
    const { result } = setup();
    const order = createOrder(result);
    expect(order.total_quoted_usd).toBe(342);

    as(result, 'sales');
    act(() => {
      expect(result.current.salesConfirmOrder(order.id).success).toBe(true);
    });
    const confirmed = orderById(result, order.id);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.total_confirmed_usd).toBe(342);
    expect(confirmed.reservation_allocations).toEqual([
      { sku_id: 'sku-9042-blk', warehouse_id: 'wh-gz', quantity: 10 },
    ]);
    expect(
      result.current.inventory.find(
        entry => entry.sku_id === 'sku-9042-blk' && entry.warehouse_id === 'wh-gz'
      )?.reserved
    ).toBe(10);

    act(() => {
      expect(result.current.salesRecordPayment(order.id, 342, 'WIRE-ZERO-GUARD').success).toBe(true);
    });
    expect(orderById(result, order.id).status).toBe('PAYMENT_RECORDED');

    act(() => {
      expect(
        result.current.salesUpdateShipment(order.id, {
          carrier: 'DHL',
          trackingNo: 'DHL-ZERO-GUARD',
          actualShipDate: '2026-12-16',
          estimatedDeliveryDate: '2026-12-20',
          customerVisibleNote: 'Shipped.',
          internalNote: 'Zero-amount guard regression.',
        }).success
      ).toBe(true);
    });
    expect(orderById(result, order.id).status).toBe('SHIPPED');
  });

  it('validates the USD 0.01 confirmation boundary and keeps the non-negative helper unchanged', () => {
    expect(validateConfirmableOrderTotal(0.01).valid).toBe(true);
    expect(validateConfirmableOrderTotal(0.005).valid).toBe(true);
    expect(validateConfirmableOrderTotal(0.009).valid).toBe(true);
    expect(validateConfirmableOrderTotal(0).valid).toBe(false);
    expect(validateConfirmableOrderTotal(0.004).valid).toBe(false);
    expect(validateConfirmableOrderTotal(-0.01).valid).toBe(false);
    expect(validateConfirmableOrderTotal(Number.NaN).valid).toBe(false);
    expect(validateConfirmableOrderTotal(Number.POSITIVE_INFINITY).valid).toBe(false);

    expect(validateOrderAmount(0).valid).toBe(true);
    expect(validateOrderAmount(-0.01).valid).toBe(false);
  });
});
