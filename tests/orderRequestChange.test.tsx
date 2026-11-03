// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp } from '../src/context/AppContext';

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

const createPendingOrder = (result: { current: ReturnType<typeof useApp> }) => {
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

afterEach(cleanup);

describe('customer order change requests', () => {
  it('returns structured errors for invalid PENDING quantities instead of throwing', () => {
    const { result } = setup();
    const order = createPendingOrder(result);
    const before = JSON.stringify(orderById(result, order.id));

    act(() => {
      const zero = result.current.customerRequestChange(order.id, 'bad', [
        { sku_id: 'sku-9042-blk', new_qty: 0 },
      ]);
      expect(zero.success).toBe(false);
      expect(zero.message).toMatch(/Minimum 10|whole number/i);
      const negative = result.current.customerRequestChange(order.id, 'bad', [
        { sku_id: 'sku-9042-blk', new_qty: -5 },
      ]);
      expect(negative.success).toBe(false);
      expect(negative.message).toMatch(/Minimum 10|whole number/i);
      const excessive = result.current.customerRequestChange(order.id, 'bad', [
        { sku_id: 'sku-9042-blk', new_qty: 999 },
      ]);
      expect(excessive.success).toBe(false);
      expect(excessive.message).toMatch(/exceeds current available stock/i);
    });

    expect(JSON.stringify(orderById(result, order.id))).toBe(before);
  });

  it('applies the same stock and sellable checks as order submission', () => {
    const { result } = setup();
    const order = createPendingOrder(result);
    const sku = result.current.products
      .find(product => product.id === 'prod-9042')!
      .skus.find(item => item.id === 'sku-9042-blk')!;

    as(result, 'admin');
    act(() => {
      expect(
        result.current.adminUpdateSku('prod-9042', sku.id, {
          skuCode: sku.sku_code,
          colorName: sku.color_name,
          colorNameEn: sku.color_name_en ?? '',
          colorHex: sku.color_hex,
          basePriceUsd: sku.base_price_usd,
          sellableStatus: 'discontinued',
        }).success
      ).toBe(true);
    });
    as(result, 'customer');
    act(() => {
      const rejected = result.current.customerRequestChange(order.id, 'bad', [
        { sku_id: sku.id, new_qty: 12 },
      ]);
      expect(rejected.success).toBe(false);
      expect(rejected.message).toMatch(/SKU is no longer available/i);
    });

    as(result, 'admin');
    act(() => {
      expect(
        result.current.adminSetProductActive('prod-9042', false).success
      ).toBe(true);
    });
    as(result, 'customer');
    act(() => {
      const rejected = result.current.customerRequestChange(order.id, 'bad', [
        { sku_id: sku.id, new_qty: 12 },
      ]);
      expect(rejected.success).toBe(false);
      expect(rejected.message).toMatch(/product is no longer available/i);
    });

    as(result, 'admin');
    act(() => {
      expect(
        result.current.adminUpdateSku('prod-9042', sku.id, {
          skuCode: sku.sku_code,
          colorName: sku.color_name,
          colorNameEn: sku.color_name_en ?? '',
          colorHex: sku.color_hex,
          basePriceUsd: sku.base_price_usd,
          sellableStatus: 'active',
        }).success
      ).toBe(true);
      expect(result.current.adminSetProductActive('prod-9042', true).success).toBe(true);
    });
    as(result, 'customer');
    act(() => {
      const accepted = result.current.customerRequestChange(order.id, 'valid', [
        { sku_id: sku.id, new_qty: 12 },
      ]);
      expect(accepted.success).toBe(true);
    });
    expect(orderById(result, order.id).lines[0]).toMatchObject({
      quantity: 12,
      line_subtotal: 410.4,
    });
    expect(orderById(result, order.id).total_quoted_usd).toBe(410.4);
    expect(
      result.current.auditLogs.some(entry => entry.action === 'MODIFY_ORDER')
    ).toBe(true);
  });

  it('adds a REQUEST_CHANGE audit event for confirmed quantity requests', () => {
    const { result } = setup();
    const before = result.current.auditLogs.filter(
      entry => entry.action === 'REQUEST_CHANGE'
    ).length;
    act(() => {
      const request = result.current.customerRequestChange('ord-001', 'increase', [
        { sku_id: 'sku-9042-blk', new_qty: 30 },
      ]);
      expect(request.success).toBe(true);
    });
    const changeLogs = result.current.auditLogs.filter(
      entry => entry.action === 'REQUEST_CHANGE'
    );
    expect(changeLogs).toHaveLength(before + 1);
    expect(changeLogs[0].target).toBe('ORD-20261028-001');
    expect(changeLogs[0].details).toMatch(/quantity change/i);
  });

  it('does not add a second cancellation audit event', () => {
    const { result } = setup();
    const before = result.current.auditLogs.filter(
      entry => entry.action === 'REQUEST_CANCEL'
    ).length;
    act(() => {
      expect(result.current.customerCancelOrder('ord-001', 'cancel').success).toBe(true);
    });
    expect(
      result.current.auditLogs.filter(entry => entry.action === 'REQUEST_CANCEL')
    ).toHaveLength(before + 1);
  });

  it('does not add an audit event when a confirmed request is invalid', () => {
    const { result } = setup();
    const before = result.current.auditLogs.filter(
      entry => entry.action === 'REQUEST_CHANGE'
    ).length;
    act(() => {
      const request = result.current.customerRequestChange('ord-001', 'bad', [
        { sku_id: 'sku-9042-blk', new_qty: 0 },
      ]);
      expect(request.success).toBe(false);
    });
    expect(
      result.current.auditLogs.filter(entry => entry.action === 'REQUEST_CHANGE')
    ).toHaveLength(before);
  });
});
