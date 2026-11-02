// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp } from '../src/context/AppContext';
import type { Order } from '../src/types';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

function setup() {
  return renderHook(() => useApp(), { wrapper });
}

const orderById = (result: ReturnType<typeof setup>['result'], id: string) => {
  const order = result.current.orders.find((item) => item.id === id);
  if (!order) throw new Error(`Order ${id} not found`);
  return order;
};

const balance = (
  result: ReturnType<typeof setup>['result'],
  skuId: string,
  warehouseId: string
) => {
  const item = result.current.inventory.find(
    (entry) => entry.sku_id === skuId && entry.warehouse_id === warehouseId
  );
  if (!item) throw new Error(`Balance ${skuId}/${warehouseId} not found`);
  return item;
};

const submitNewBlackOrder = (result: ReturnType<typeof setup>['result']) => {
  act(() => {
    const cart = result.current.addToCart('sku-9042-blk', 10);
    expect(cart.success).toBe(true);
  });
  let orderId = '';
  act(() => {
    const submitted = result.current.submitOrder({
      shippingMethod: 'Sea',
      destinationCountryAlpha3: 'USA',
      expectedShipDate: '2026-12-15',
      shippingRequirements: 'Standard export carton.',
    });
    expect(submitted.success).toBe(true);
    orderId = submitted.orderId!;
  });
  return orderId;
};

afterEach(() => cleanup());

describe('order lifecycle integration', () => {
  it('confirms, pays and ships once with concrete multi-warehouse values', async () => {
    const { result } = setup();
    const orderId = submitNewBlackOrder(result);
    expect(orderById(result, orderId).status).toBe('PENDING_CONFIRMATION');

    act(() => {
      expect(result.current.salesConfirmOrder(orderId).success).toBe(true);
    });
    let order = orderById(result, orderId);
    expect(order.status).toBe('CONFIRMED');
    expect(order.reservation_allocations).toEqual([
      { sku_id: 'sku-9042-blk', warehouse_id: 'wh-gz', quantity: 10 },
    ]);
    expect(balance(result, 'sku-9042-blk', 'wh-gz')).toMatchObject({
      on_hand: 90,
      reserved: 10,
    });
    expect(balance(result, 'sku-9042-blk', 'wh-sh')).toMatchObject({
      on_hand: 160,
      reserved: 20,
    });

    act(() => {
      expect(result.current.salesRecordPayment(orderId, 342, 'WIRE-TEST-001').success).toBe(true);
    });
    expect(orderById(result, orderId).status).toBe('PAYMENT_RECORDED');
    expect(result.current.companies.find((company) => company.id === 'comp-001')).toMatchObject({
      cumulative_spend_usd: 68742,
      months_inactive: 0,
    });

    act(() => {
      const shipped = result.current.salesUpdateShipment(orderId, {
        carrier: 'DHL',
        trackingNo: 'DHL-TEST-1',
        actualShipDate: '2026-12-16',
        estimatedDeliveryDate: '2026-12-20',
        customerVisibleNote: 'Shipped.',
        internalNote: 'Test shipment.',
      });
      expect(shipped.success).toBe(true);
    });
    order = orderById(result, orderId);
    expect(order.status).toBe('SHIPPED');
    expect(balance(result, 'sku-9042-blk', 'wh-gz')).toMatchObject({
      on_hand: 80,
      reserved: 0,
    });
    expect(balance(result, 'sku-9042-blk', 'wh-sh')).toMatchObject({
      on_hand: 160,
      reserved: 20,
    });

    await Promise.resolve();
    const inventoryAfterShip = JSON.stringify(result.current.inventory);
    const ordersAfterShip = JSON.stringify(result.current.orders);
    const spendAfterShip = result.current.companies.find((company) => company.id === 'comp-001')!
      .cumulative_spend_usd;
    act(() => {
      expect(
        result.current.salesUpdateShipment(orderId, {
          carrier: 'DHL',
          trackingNo: 'DHL-TEST-2',
          actualShipDate: '2026-12-17',
          estimatedDeliveryDate: '2026-12-21',
          customerVisibleNote: 'Duplicate.',
          internalNote: 'Duplicate.',
        }).success
      ).toBe(false);
      expect(result.current.salesRecordPayment(orderId, 342, 'WIRE-TEST-002').success).toBe(false);
    });
    expect(JSON.stringify(result.current.inventory)).toBe(inventoryAfterShip);
    expect(JSON.stringify(result.current.orders)).toBe(ordersAfterShip);
    expect(
      result.current.companies.find((company) => company.id === 'comp-001')!.cumulative_spend_usd
    ).toBe(spendAfterShip);
  });

  it('blocks two confirmations issued in the same event before React re-renders', () => {
    const { result } = setup();
    const orderId = submitNewBlackOrder(result);
    let first: { success: boolean } | undefined;
    let second: { success: boolean; error?: string } | undefined;
    act(() => {
      first = result.current.salesConfirmOrder(orderId);
      second = result.current.salesConfirmOrder(orderId);
    });
    expect(first?.success).toBe(true);
    expect(second?.success).toBe(false);
    expect(second?.error).toMatch(/正在进行/);
    expect(balance(result, 'sku-9042-blk', 'wh-gz').reserved).toBe(10);
    expect(balance(result, 'sku-9042-blk', 'wh-sh').reserved).toBe(20);
  });

  it('rejects underpayment/overpayment and allows exact full payment before shipment', async () => {
    const { result } = setup();
    const orderBefore = JSON.stringify(orderById(result, 'ord-001'));
    const inventoryBefore = JSON.stringify(result.current.inventory);
    const spendBefore = result.current.companies.find((company) => company.id === 'comp-001')!
      .cumulative_spend_usd;

    act(() => {
      const under = result.current.salesRecordPayment('ord-001', 1268.99, 'WIRE-UNDER');
      expect(under.success).toBe(false);
      expect(under.error).toMatch(/不足/);
    });
    await Promise.resolve();
    act(() => {
      const over = result.current.salesRecordPayment('ord-001', 1269.01, 'WIRE-OVER');
      expect(over.success).toBe(false);
      expect(over.error).toMatch(/超过/);
    });
    await Promise.resolve();
    act(() => {
      const fractional = result.current.salesRecordPayment('ord-001', 1268.999, 'WIRE-FRACTION');
      expect(fractional.success).toBe(false);
    });
    expect(JSON.stringify(orderById(result, 'ord-001'))).toBe(orderBefore);
    expect(JSON.stringify(result.current.inventory)).toBe(inventoryBefore);
    expect(
      result.current.companies.find((company) => company.id === 'comp-001')!.cumulative_spend_usd
    ).toBe(spendBefore);
    expect(orderById(result, 'ord-001').status).toBe('CONFIRMED');

    await Promise.resolve();
    act(() => {
      expect(
        result.current.salesUpdateShipment('ord-001', {
          carrier: 'DHL',
          trackingNo: 'DHL-UNDERPAID',
          actualShipDate: '2026-11-05',
          estimatedDeliveryDate: '2026-11-10',
          customerVisibleNote: 'Must not ship.',
          internalNote: 'Must not ship.',
        }).success
      ).toBe(false);
    });
    expect(orderById(result, 'ord-001').status).toBe('CONFIRMED');

    await Promise.resolve();
    act(() => {
      const full = result.current.salesRecordPayment('ord-001', 1269, 'WIRE-FULL');
      expect(full.success).toBe(true);
    });
    const paid = orderById(result, 'ord-001');
    expect(paid.status).toBe('PAYMENT_RECORDED');
    expect(paid.payment_amount_usd).toBe(1269);
    expect(
      result.current.companies.find((company) => company.id === 'comp-001')!.cumulative_spend_usd
    ).toBe(69669);

    act(() => {
      expect(
        result.current.salesUpdateShipment('ord-001', {
          carrier: 'DHL',
          trackingNo: 'DHL-FULL-PAY',
          actualShipDate: '2026-11-05',
          estimatedDeliveryDate: '2026-11-10',
          customerVisibleNote: 'Shipped after full payment.',
          internalNote: 'Full payment verified.',
        }).success
      ).toBe(true);
    });
    expect(orderById(result, 'ord-001').status).toBe('SHIPPED');
    expect(balance(result, 'sku-9042-blk', 'wh-sh')).toMatchObject({
      on_hand: 140,
      reserved: 0,
    });
    expect(balance(result, 'sku-7710-slv', 'wh-sh')).toMatchObject({
      on_hand: 140,
      reserved: 0,
    });
  });

  it('blocks payment and release while a cancellation request is pending', () => {
    const { result } = setup();
    act(() => {
      expect(result.current.customerCancelOrder('ord-001', 'Pending cancellation').success).toBe(
        true
      );
    });
    expect(orderById(result, 'ord-001').change_request?.status).toBe('pending');
    const orderBefore = JSON.stringify(orderById(result, 'ord-001'));
    const inventoryBefore = JSON.stringify(result.current.inventory);
    const spendBefore = result.current.companies.find((company) => company.id === 'comp-001')!
      .cumulative_spend_usd;
    act(() => {
      const payment = result.current.salesRecordPayment('ord-001', 1269, 'WIRE-PENDING');
      expect(payment.success).toBe(false);
      expect(payment.error).toMatch(/待审核/);
      const release = result.current.salesReleaseReservation('ord-001', 'Pending release');
      expect(release.success).toBe(false);
      expect(release.error).toMatch(/待审核/);
    });
    expect(JSON.stringify(orderById(result, 'ord-001'))).toBe(orderBefore);
    expect(JSON.stringify(result.current.inventory)).toBe(inventoryBefore);
    expect(
      result.current.companies.find((company) => company.id === 'comp-001')!.cumulative_spend_usd
    ).toBe(spendBefore);
    expect(orderById(result, 'ord-001').change_request?.status).toBe('pending');
  });

  it('blocks payment and release while a modification request is pending', () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.customerRequestChange('ord-001', 'Pending modification', [
          { sku_id: 'sku-9042-blk', new_qty: 30 },
        ]).success
      ).toBe(true);
    });
    expect(orderById(result, 'ord-001').change_request?.status).toBe('pending');
    const orderBefore = JSON.stringify(orderById(result, 'ord-001'));
    const inventoryBefore = JSON.stringify(result.current.inventory);
    const spendBefore = result.current.companies.find((company) => company.id === 'comp-001')!
      .cumulative_spend_usd;
    act(() => {
      const duplicate = result.current.customerRequestChange('ord-001', 'Overwrite attempt', [
        { sku_id: 'sku-9042-blk', new_qty: 40 },
      ]);
      expect(duplicate.success).toBe(false);
      expect(result.current.salesRecordPayment('ord-001', 1269, 'WIRE-PENDING-MOD').success).toBe(
        false
      );
      expect(result.current.salesReleaseReservation('ord-001', 'Pending modification').success).toBe(
        false
      );
    });
    expect(JSON.stringify(orderById(result, 'ord-001'))).toBe(orderBefore);
    expect(JSON.stringify(result.current.inventory)).toBe(inventoryBefore);
    expect(
      result.current.companies.find((company) => company.id === 'comp-001')!.cumulative_spend_usd
    ).toBe(spendBefore);
    expect(orderById(result, 'ord-001').change_request?.status).toBe('pending');
  });

  it('allows payment and shipment after a quantity change is approved', async () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.customerRequestChange('ord-001', 'Increase black', [
          { sku_id: 'sku-9042-blk', new_qty: 30 },
        ]).success
      ).toBe(true);
    });
    await Promise.resolve();
    act(() => {
      expect(result.current.salesHandleChangeRequest('ord-001', true).success).toBe(true);
    });
    expect(orderById(result, 'ord-001').total_confirmed_usd).toBe(1611);
    expect(orderById(result, 'ord-001').change_request?.status).toBe('approved');

    act(() => {
      expect(result.current.salesRecordPayment('ord-001', 1611, 'WIRE-CHANGED').success).toBe(true);
    });
    expect(orderById(result, 'ord-001').status).toBe('PAYMENT_RECORDED');
    expect(
      result.current.companies.find((company) => company.id === 'comp-001')!.cumulative_spend_usd
    ).toBe(70011);

    act(() => {
      expect(
        result.current.salesUpdateShipment('ord-001', {
          carrier: 'DHL',
          trackingNo: 'DHL-CHANGED',
          actualShipDate: '2026-11-06',
          estimatedDeliveryDate: '2026-11-11',
          customerVisibleNote: 'Shipped after approved change.',
          internalNote: 'Approved quantity change.',
        }).success
      ).toBe(true);
    });
    expect(orderById(result, 'ord-001').status).toBe('SHIPPED');
    expect(balance(result, 'sku-9042-blk', 'wh-gz')).toMatchObject({
      on_hand: 60,
      reserved: 0,
    });
    expect(balance(result, 'sku-7710-slv', 'wh-sh')).toMatchObject({
      on_hand: 140,
      reserved: 0,
    });
  });

  it('rejects duplicate confirmation without touching inventory', async () => {
    const { result } = setup();
    const orderId = submitNewBlackOrder(result);
    act(() => {
      expect(result.current.salesConfirmOrder(orderId).success).toBe(true);
    });
    await Promise.resolve();
    const inventory = JSON.stringify(result.current.inventory);
    const order = JSON.stringify(orderById(result, orderId));
    act(() => {
      const duplicate = result.current.salesConfirmOrder(orderId);
      expect(duplicate.success).toBe(false);
      expect(duplicate.error).toMatch(/待确认/);
    });
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
    expect(JSON.stringify(orderById(result, orderId))).toBe(order);
  });

  it('blocks a same-tick duplicate extension while allowing a later deliberate extension', async () => {
    const { result } = setup();
    let first: { success: boolean } | undefined;
    let second: { success: boolean; error?: string } | undefined;
    act(() => {
      first = result.current.salesExtendReservation('ord-001', 48);
      second = result.current.salesExtendReservation('ord-001', 48);
    });
    expect(first?.success).toBe(true);
    expect(second?.success).toBe(false);
    expect(second?.error).toMatch(/正在进行/);
    expect(orderById(result, 'ord-001').reservation_extended_count).toBe(1);
    await Promise.resolve();
    act(() => {
      expect(result.current.salesExtendReservation('ord-001', 48).success).toBe(true);
    });
    expect(orderById(result, 'ord-001').reservation_extended_count).toBe(2);
  });

  it('releases a confirmed order once and rejects repeated release', async () => {
    const { result } = setup();
    expect(balance(result, 'sku-9042-blk', 'wh-sh').reserved).toBe(20);
    expect(balance(result, 'sku-7710-slv', 'wh-sh').reserved).toBe(10);
    act(() => {
      expect(result.current.salesExtendReservation('ord-001', 48).success).toBe(true);
      expect(result.current.salesReleaseReservation('ord-001', 'Test release').success).toBe(true);
    });
    expect(orderById(result, 'ord-001').status).toBe('RESERVATION_EXPIRED');
    expect(balance(result, 'sku-9042-blk', 'wh-sh').reserved).toBe(0);
    expect(balance(result, 'sku-7710-slv', 'wh-sh').reserved).toBe(0);

    await Promise.resolve();
    const inventory = JSON.stringify(result.current.inventory);
    const order = JSON.stringify(orderById(result, 'ord-001'));
    act(() => {
      const duplicate = result.current.salesReleaseReservation('ord-001', 'Again');
      expect(duplicate.success).toBe(false);
      expect(duplicate.error).toMatch(/已确认/);
    });
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
    expect(JSON.stringify(orderById(result, 'ord-001'))).toBe(order);
  });

  it('approves a quantity change, reallocates warehouses and updates line totals', async () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.customerRequestChange('ord-001', 'Increase black', [
          { sku_id: 'sku-9042-blk', new_qty: 30 },
        ]).success
      ).toBe(true);
    });
    expect(orderById(result, 'ord-001').change_request?.status).toBe('pending');

    act(() => {
      expect(result.current.salesHandleChangeRequest('ord-001', true).success).toBe(true);
    });
    const order = orderById(result, 'ord-001');
    expect(order.change_request?.status).toBe('approved');
    expect(order.lines.find((line) => line.sku_id === 'sku-9042-blk')).toMatchObject({
      quantity: 30,
      line_subtotal: 1026,
    });
    expect(order.lines.find((line) => line.sku_id === 'sku-7710-slv')).toMatchObject({
      quantity: 10,
      line_subtotal: 585,
    });
    expect(order.total_quoted_usd).toBe(1611);
    expect(order.total_confirmed_usd).toBe(1611);
    expect(order.reservation_allocations).toEqual([
      { sku_id: 'sku-9042-blk', warehouse_id: 'wh-gz', quantity: 30 },
      { sku_id: 'sku-7710-slv', warehouse_id: 'wh-sh', quantity: 10 },
    ]);
    expect(balance(result, 'sku-9042-blk', 'wh-gz').reserved).toBe(30);
    expect(balance(result, 'sku-9042-blk', 'wh-sh').reserved).toBe(0);
    expect(balance(result, 'sku-7710-slv', 'wh-sh').reserved).toBe(10);

    await Promise.resolve();
    const inventory = JSON.stringify(result.current.inventory);
    const orderState = JSON.stringify(order);
    act(() => {
      expect(result.current.salesHandleChangeRequest('ord-001', true).success).toBe(false);
    });
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
    expect(JSON.stringify(orderById(result, 'ord-001'))).toBe(orderState);
  });

  it('keeps the whole order unchanged when an approved quantity increase lacks stock', () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.customerRequestChange('ord-001', 'Too many', [
          { sku_id: 'sku-9042-blk', new_qty: 300 },
        ]).success
      ).toBe(true);
    });
    const inventory = JSON.stringify(result.current.inventory);
    const orderState = JSON.stringify(orderById(result, 'ord-001'));
    act(() => {
      const resultValue = result.current.salesHandleChangeRequest('ord-001', true);
      expect(resultValue.success).toBe(false);
      expect(resultValue.error).toMatch(/库存不足/);
    });
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
    expect(JSON.stringify(orderById(result, 'ord-001'))).toBe(orderState);
    expect(orderById(result, 'ord-001').change_request?.status).toBe('pending');
  });

  it('approves a cancellation request by releasing the exact allocations', async () => {
    const { result } = setup();
    act(() => {
      expect(result.current.customerCancelOrder('ord-001', 'Customer cancelled').success).toBe(true);
    });
    expect(orderById(result, 'ord-001').change_request?.status).toBe('pending');

    act(() => {
      expect(result.current.salesHandleChangeRequest('ord-001', true).success).toBe(true);
    });
    expect(orderById(result, 'ord-001').status).toBe('CANCELLED');
    expect(balance(result, 'sku-9042-blk', 'wh-sh').reserved).toBe(0);
    expect(balance(result, 'sku-7710-slv', 'wh-sh').reserved).toBe(0);
    await Promise.resolve();
    const inventory = JSON.stringify(result.current.inventory);
    act(() => {
      expect(result.current.salesHandleChangeRequest('ord-001', true).success).toBe(false);
    });
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
  });

  it('rejects a change request without changing order or inventory', () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.customerRequestChange('ord-001', 'Try later', [
          { sku_id: 'sku-9042-blk', new_qty: 30 },
        ]).success
      ).toBe(true);
    });
    const inventory = JSON.stringify(result.current.inventory);
    const before = { ...orderById(result, 'ord-001') };
    act(() => {
      expect(result.current.salesHandleChangeRequest('ord-001', false).success).toBe(true);
    });
    const after = orderById(result, 'ord-001');
    expect(after.lines).toEqual(before.lines);
    expect(after.reservation_allocations).toEqual(before.reservation_allocations);
    expect(after.change_request?.status).toBe('rejected');
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
  });

  it('ships the paid legacy order once and rejects repeated payment/shipment', async () => {
    const { result } = setup();
    expect(balance(result, 'sku-8015-nvy', 'wh-sh').reserved).toBe(100);
    const spend = result.current.companies.find((company) => company.id === 'comp-001')!
      .cumulative_spend_usd;
    act(() => {
      expect(result.current.salesRecordPayment('ord-002', 2520, 'DUPLICATE').success).toBe(false);
      expect(result.current.salesReleaseReservation('ord-002', 'Paid').success).toBe(false);
      expect(
        result.current.salesUpdateShipment('ord-002', {
          carrier: 'DHL',
          trackingNo: 'DHL-LEGACY-1',
          actualShipDate: '2026-11-03',
          estimatedDeliveryDate: '2026-11-08',
          customerVisibleNote: 'Shipped.',
          internalNote: 'Legacy paid order.',
        }).success
      ).toBe(true);
    });
    expect(orderById(result, 'ord-002').status).toBe('SHIPPED');
    expect(balance(result, 'sku-8015-nvy', 'wh-sh')).toMatchObject({
      on_hand: 100,
      reserved: 0,
    });
    expect(balance(result, 'sku-8015-nvy', 'wh-nb')).toMatchObject({
      on_hand: 100,
      reserved: 0,
    });
    expect(
      result.current.companies.find((company) => company.id === 'comp-001')!.cumulative_spend_usd
    ).toBe(spend);

    await Promise.resolve();
    const inventory = JSON.stringify(result.current.inventory);
    const order = JSON.stringify(orderById(result, 'ord-002'));
    act(() => {
      expect(
        result.current.salesUpdateShipment('ord-002', {
          carrier: 'DHL',
          trackingNo: 'DHL-LEGACY-2',
          actualShipDate: '2026-11-04',
          estimatedDeliveryDate: '2026-11-09',
          customerVisibleNote: 'Duplicate.',
          internalNote: 'Duplicate.',
        }).success
      ).toBe(false);
    });
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
    expect(JSON.stringify(orderById(result, 'ord-002'))).toBe(order);
  });

  it('fails the entire confirmation when one SKU is short', () => {
    const { result } = setup();
    const orderId = submitNewBlackOrder(result);
    act(() => {
      const imported = result.current.excelImportStock([
        { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 20, unsellable: 0 },
        { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-GZ', on_hand: 0, unsellable: 0 },
      ]);
      expect(imported.success).toBe(true);
      expect(imported.count).toBe(2);
    });
    const inventory = JSON.stringify(result.current.inventory);
    act(() => {
      const confirmation = result.current.salesConfirmOrder(orderId);
      expect(confirmation.success).toBe(false);
      expect(confirmation.error).toMatch(/库存不足/);
    });
    expect(orderById(result, orderId).status).toBe('PENDING_CONFIRMATION');
    expect(JSON.stringify(result.current.inventory)).toBe(inventory);
    expect(balance(result, 'sku-9042-blk', 'wh-sh').reserved).toBe(20);
    expect(balance(result, 'sku-9042-blk', 'wh-gz').reserved).toBe(0);
  });
});
