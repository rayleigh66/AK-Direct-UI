// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { INITIAL_INVENTORY, INITIAL_PRODUCTS, INITIAL_WAREHOUSES } from '../src/data/mockData';
import { AppProvider, useApp } from '../src/context/AppContext';
import { parseCsv, parseInventoryTable, validateInventoryImport } from '../src/utils/inventoryImport';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

const asSales = (result: { current: ReturnType<typeof useApp> }) => {
  act(() => {
    result.current.switchRole('sales');
  });
};
const asAdmin = (result: { current: ReturnType<typeof useApp> }) => {
  act(() => {
    result.current.switchRole('admin');
  });
};

afterEach(cleanup);

describe('inventory file parsing and validation', () => {
  it('parses CSV with quoted fields and validates a real snapshot row', () => {
    const state = {
      products: INITIAL_PRODUCTS,
      warehouses: INITIAL_WAREHOUSES,
      inventory: INITIAL_INVENTORY,
    };
    const csv = 'sku_code,warehouse_code,on_hand,unsellable\n"AK-9042-BLK","WH-SH",100,5\n';
    const parsed = parseInventoryTable(parseCsv(csv));
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toEqual([
      { rowNumber: 2, skuCode: 'AK-9042-BLK', warehouseCode: 'WH-SH', onHand: 100, unsellable: 5 },
    ]);
    const checked = validateInventoryImport(
      parsed.lines,
      state.products,
      state.warehouses,
      state.inventory
    );
    expect(checked.valid).toBe(true);
    expect(checked.rows[0]).toMatchObject({
      previousOnHand: 160,
      previousUnsellable: 0,
      previousAvailable: 140,
      reserved: 20,
      nextAvailable: 75,
    });
  });

  it('reports missing headers, unknown SKU/warehouse, duplicates and invalid numbers', () => {
    const state = {
      products: INITIAL_PRODUCTS,
      warehouses: INITIAL_WAREHOUSES,
      inventory: INITIAL_INVENTORY,
    };
    expect(parseInventoryTable([['sku_code', 'warehouse_code']]).errors).toContain(
      'Missing required column: on_hand.'
    );
    const badRows = parseInventoryTable([
      ['sku_code', 'warehouse_code', 'on_hand', 'unsellable'],
      ['AK-9042-BLK', 'WH-SH', -1, 0],
      ['AK-9042-BLK', 'WH-SH', 'abc', 0],
      ['AK-9042-BLK', 'WH-SH', 10, 0],
      ['AK-9042-BLK', 'WH-SH', 10, 0],
    ]);
    expect(badRows.errors.length).toBeGreaterThan(0);
    const valid = parseInventoryTable([
      ['sku_code', 'warehouse_code', 'on_hand', 'unsellable'],
      ['UNKNOWN-SKU', 'WH-SH', 10, 0],
      ['AK-9042-BLK', 'UNKNOWN-WH', 10, 0],
      ['AK-9042-BLK', 'WH-SH', 10, 0],
    ]);
    const checked = validateInventoryImport(
      valid.lines,
      state.products,
      state.warehouses,
      state.inventory
    );
    expect(checked.valid).toBe(false);
    expect(checked.errors.join(' ')).toMatch(/Unknown SKU/);
    expect(checked.errors.join(' ')).toMatch(/Unknown warehouse/);
    expect(checked.errors.join(' ')).toMatch(/reserved quantity/);
  });

  it('rejects new balance creation and unsellable above on-hand', () => {
    const state = {
      products: INITIAL_PRODUCTS,
      warehouses: INITIAL_WAREHOUSES,
      inventory: INITIAL_INVENTORY,
    };
    const parsed = parseInventoryTable([
      ['sku_code', 'warehouse_code', 'on_hand', 'unsellable'],
      ['AK-7710-BLK', 'WH-SH', 10, 0],
      ['AK-9042-BLK', 'WH-SH', 10, 20],
    ]);
    const checked = validateInventoryImport(
      parsed.lines,
      state.products,
      state.warehouses,
      state.inventory
    );
    expect(checked.valid).toBe(false);
    expect(checked.errors.join(' ')).toMatch(/No existing inventory balance/);
    expect(checked.errors.join(' ')).toMatch(/Unsellable quantity cannot exceed on-hand/);
  });

  it('rejects a stale preview when reserved changes and accepts a refreshed confirmation', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    const line = {
      rowNumber: 2,
      skuCode: 'AK-9042-BLK',
      warehouseCode: 'WH-SH',
      onHand: 100,
      unsellable: 5,
    };
    const preview = validateInventoryImport(
      [line],
      result.current.products,
      result.current.warehouses,
      result.current.inventory
    );
    const expected = preview.rows.map(row => ({
      sku_code: row.line.skuCode,
      warehouse_code: row.line.warehouseCode,
      previousOnHand: row.previousOnHand ?? -1,
      previousUnsellable: row.previousUnsellable ?? -1,
      reserved: row.reserved,
    }));
    asSales(result);
    act(() => {
      expect(result.current.salesReleaseReservation('ord-001', 'test').success).toBe(true);
    });
    await Promise.resolve();
    asAdmin(result);
    const afterRelease = JSON.stringify(result.current.inventory);
    const auditBefore = result.current.auditLogs.filter(
      entry => entry.action === 'EXCEL_IMPORT_STOCK'
    ).length;
    let staleResult: ReturnType<typeof result.current.excelImportStock> | undefined;
    act(() => {
      staleResult = result.current.excelImportStock(
        [{ sku_code: line.skuCode, warehouse_code: line.warehouseCode, on_hand: line.onHand, unsellable: line.unsellable }],
        expected
      );
    });
    expect(staleResult?.success).toBe(false);
    expect(staleResult?.stale).toBe(true);
    expect(JSON.stringify(result.current.inventory)).toBe(afterRelease);
    expect(
      result.current.auditLogs.filter(entry => entry.action === 'EXCEL_IMPORT_STOCK').length
    ).toBe(auditBefore);

    const refreshed = validateInventoryImport(
      [line],
      result.current.products,
      result.current.warehouses,
      result.current.inventory
    );
    expect(refreshed.rows[0]?.reserved).toBe(0);
    act(() => {
      expect(
        result.current.excelImportStock(
          [{ sku_code: line.skuCode, warehouse_code: line.warehouseCode, on_hand: line.onHand, unsellable: line.unsellable }],
          refreshed.rows.map(row => ({
            sku_code: row.line.skuCode,
            warehouse_code: row.line.warehouseCode,
            previousOnHand: row.previousOnHand ?? -1,
            previousUnsellable: row.previousUnsellable ?? -1,
            reserved: row.reserved,
          }))
        ).success
      ).toBe(true);
    });
  });

  it('marks a preview stale when reserved increases and the old import becomes invalid', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });

    act(() => {
      expect(result.current.addToCart('sku-9042-blk', 10).success).toBe(true);
    });
    act(() => {
      expect(
        result.current.submitOrder({
          shippingMethod: 'Sea',
          destinationCountryAlpha3: 'USA',
          expectedShipDate: '2026-12-15',
          shippingRequirements: 'Standard export carton.',
        }).success
      ).toBe(true);
    });
    const orderId = result.current.orders[0].id;

    const line = {
      rowNumber: 2,
      skuCode: 'AK-9042-BLK',
      warehouseCode: 'WH-GZ',
      onHand: 5,
      unsellable: 0,
    };
    const preview = validateInventoryImport(
      [line],
      result.current.products,
      result.current.warehouses,
      result.current.inventory
    );
    expect(preview.valid).toBe(true);
    expect(preview.rows[0]?.reserved).toBe(0);
    const expected = preview.rows.map(row => ({
      sku_code: row.line.skuCode,
      warehouse_code: row.line.warehouseCode,
      previousOnHand: row.previousOnHand ?? -1,
      previousUnsellable: row.previousUnsellable ?? -1,
      reserved: row.reserved,
    }));

    asSales(result);
    await act(async () => {
      expect(result.current.salesConfirmOrder(orderId).success).toBe(true);
      await Promise.resolve();
    });
    expect(
      result.current.inventory.find(
        entry => entry.sku_id === 'sku-9042-blk' && entry.warehouse_id === 'wh-gz'
      )?.reserved
    ).toBe(10);

    const refreshed = validateInventoryImport(
      [line],
      result.current.products,
      result.current.warehouses,
      result.current.inventory
    );
    expect(refreshed.valid).toBe(false);
    expect(refreshed.errors.join(' ')).toMatch(/reserved stock cannot be overwritten/i);

    asAdmin(result);
    const inventoryBefore = JSON.stringify(result.current.inventory);
    const auditBefore = result.current.auditLogs.filter(
      entry => entry.action === 'EXCEL_IMPORT_STOCK'
    ).length;
    let staleResult: ReturnType<typeof result.current.excelImportStock> | undefined;
    act(() => {
      staleResult = result.current.excelImportStock(
        [
          {
            sku_code: line.skuCode,
            warehouse_code: line.warehouseCode,
            on_hand: line.onHand,
            unsellable: line.unsellable,
          },
        ],
        expected
      );
    });
    expect(staleResult?.success).toBe(false);
    expect(staleResult?.stale).toBe(true);
    expect(staleResult?.error).toMatch(/reserved stock cannot be overwritten/i);
    expect(JSON.stringify(result.current.inventory)).toBe(inventoryBefore);
    expect(
      result.current.auditLogs.filter(entry => entry.action === 'EXCEL_IMPORT_STOCK').length
    ).toBe(auditBefore);
    expect(refreshed.valid).toBe(false);
  });

  it('rejects a stale preview when another stock update changes the source balance', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    const line = {
      rowNumber: 2,
      skuCode: 'AK-9042-BLK',
      warehouseCode: 'WH-SH',
      onHand: 100,
      unsellable: 5,
    };
    const preview = validateInventoryImport(
      [line],
      result.current.products,
      result.current.warehouses,
      result.current.inventory
    );
    const expected = preview.rows.map(row => ({
      sku_code: row.line.skuCode,
      warehouse_code: row.line.warehouseCode,
      previousOnHand: row.previousOnHand ?? -1,
      previousUnsellable: row.previousUnsellable ?? -1,
      reserved: row.reserved,
    }));
    asAdmin(result);
    await act(async () => {
      expect(
        result.current.excelImportStock([
          { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 90, unsellable: 0 },
        ]).success
      ).toBe(true);
      await Promise.resolve();
    });
    const afterAnotherUpdate = JSON.stringify(result.current.inventory);
    await act(async () => {
      const stale = result.current.excelImportStock(
        [{ sku_code: line.skuCode, warehouse_code: line.warehouseCode, on_hand: 100, unsellable: 5 }],
        expected
      );
      expect(stale.success).toBe(false);
      expect(stale.stale).toBe(true);
      await Promise.resolve();
    });
    expect(JSON.stringify(result.current.inventory)).toBe(afterAnotherUpdate);
  });

  it('rejects mixed, duplicate, unknown and missing-balance batches atomically', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    asAdmin(result);
    const before = JSON.stringify(result.current.inventory);
    const beforeAudit = result.current.auditLogs.filter(
      entry => entry.action === 'EXCEL_IMPORT_STOCK'
    ).length;
    const batches = [
      [
        { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 100, unsellable: 5 },
        { sku_code: 'UNKNOWN-SKU', warehouse_code: 'WH-SH', on_hand: 10, unsellable: 0 },
      ],
      [
        { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 100, unsellable: 5 },
        { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 90, unsellable: 0 },
      ],
      [{ sku_code: 'AK-7710-BLK', warehouse_code: 'WH-SH', on_hand: 10, unsellable: 0 }],
      [{ sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 10, unsellable: 0 }],
      [{ sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: -1, unsellable: 0 }],
    ];
    for (const batch of batches) {
      act(() => {
        const resultValue = result.current.excelImportStock(batch);
        expect(resultValue.success).toBe(false);
        expect(resultValue.error).toBeTruthy();
      });
      expect(JSON.stringify(result.current.inventory)).toBe(before);
      expect(
        result.current.auditLogs.filter(entry => entry.action === 'EXCEL_IMPORT_STOCK').length
      ).toBe(beforeAudit);
    }
  });

  it('updates only Mock inventory on commit and preserves reserved quantities', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    asAdmin(result);
    const before = result.current.inventory.find(
      entry => entry.sku_id === 'sku-9042-blk' && entry.warehouse_id === 'wh-sh'
    )!;
    await act(async () => {
      expect(
        result.current.excelImportStock([
          { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 100, unsellable: 5 },
          { sku_code: 'AK-7710-SLV', warehouse_code: 'WH-SH', on_hand: 180, unsellable: 5 },
        ]).success
      ).toBe(true);
      await Promise.resolve();
    });
    const after = result.current.inventory.find(
      entry => entry.sku_id === 'sku-9042-blk' && entry.warehouse_id === 'wh-sh'
    )!;
    const afterSecond = result.current.inventory.find(
      entry => entry.sku_id === 'sku-7710-slv' && entry.warehouse_id === 'wh-sh'
    )!;
    expect(after.on_hand).toBe(100);
    expect(after.unsellable).toBe(5);
    expect(after.reserved).toBe(before.reserved);
    expect(afterSecond.on_hand).toBe(180);
    expect(afterSecond.unsellable).toBe(5);
    expect(afterSecond.reserved).toBe(10);
    expect(result.current.orders).toHaveLength(3);
    expect(
      result.current.auditLogs.filter(entry => entry.action === 'EXCEL_IMPORT_STOCK')
    ).toHaveLength(1);
  });
});
