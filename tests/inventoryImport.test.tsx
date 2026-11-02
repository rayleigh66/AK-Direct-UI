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

  it('updates only Mock inventory on commit and preserves reserved quantities', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    const before = result.current.inventory.find(
      entry => entry.sku_id === 'sku-9042-blk' && entry.warehouse_id === 'wh-sh'
    )!;
    await act(async () => {
      expect(
        result.current.excelImportStock([
          { sku_code: 'AK-9042-BLK', warehouse_code: 'WH-SH', on_hand: 100, unsellable: 5 },
        ]).success
      ).toBe(true);
      await Promise.resolve();
    });
    const after = result.current.inventory.find(
      entry => entry.sku_id === 'sku-9042-blk' && entry.warehouse_id === 'wh-sh'
    )!;
    expect(after.on_hand).toBe(100);
    expect(after.unsellable).toBe(5);
    expect(after.reserved).toBe(before.reserved);
    expect(result.current.orders).toHaveLength(3);
  });
});
