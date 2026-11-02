import type { InventoryBalance, Product, Warehouse } from '../types';

export interface InventoryImportLine {
  rowNumber: number;
  skuCode: string;
  warehouseCode: string;
  onHand: number;
  unsellable: number;
}

export interface InventoryImportRow {
  line: InventoryImportLine;
  skuId?: string;
  warehouseId?: string;
  previousOnHand?: number;
  previousUnsellable?: number;
  previousAvailable?: number;
  reserved: number;
  nextAvailable?: number;
  errors: string[];
  valid: boolean;
}

export interface InventoryImportValidation {
  rows: InventoryImportRow[];
  valid: boolean;
  errors: string[];
  validLines: InventoryImportLine[];
}

const HEADERS = ['sku_code', 'warehouse_code', 'on_hand', 'unsellable'] as const;
const MAX_ROWS = 500;

const normaliseHeader = (value: unknown) =>
  String(value ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

function integer(value: unknown, label: string): { value?: number; error?: string } {
  const raw = text(value);
  if (!raw) return { error: `${label} is required.` };
  if (!/^\d+$/.test(raw)) return { error: `${label} must be a non-negative whole number.` };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return { error: `${label} is too large.` };
  return { value: parsed };
}

/** Parse RFC4180-style CSV including quoted commas and escaped quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = input.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(cells => cells.some(cell => cell.trim().length > 0));
}

/** Convert the first sheet/CSV table into typed rows with structural row errors. */
export function parseInventoryTable(
  table: unknown[][]
): { lines: InventoryImportLine[]; errors: string[] } {
  const errors: string[] = [];
  if (!table.length) return { lines: [], errors: ['The file is empty.'] };
  const headers = table[0].map(normaliseHeader);
  const indexes = new Map<string, number>();
  for (const header of HEADERS) {
    const index = headers.indexOf(header);
    if (index < 0) errors.push(`Missing required column: ${header}.`);
    indexes.set(header, index);
  }
  if (errors.length) return { lines: [], errors };

  const lines: InventoryImportLine[] = [];
  const seen = new Set<string>();
  if (table.length - 1 > MAX_ROWS) {
    return { lines: [], errors: [`A maximum of ${MAX_ROWS} data rows is supported in this Demo.`] };
  }
  for (let rowIndex = 1; rowIndex < table.length; rowIndex++) {
    const cells = table[rowIndex];
    if (!cells.some(cell => text(cell).length)) continue;
    const rowNumber = rowIndex + 1;
    const skuCode = text(cells[indexes.get('sku_code')!]).toUpperCase();
    const warehouseCode = text(cells[indexes.get('warehouse_code')!]).toUpperCase();
    const onHand = integer(cells[indexes.get('on_hand')!], 'On-hand');
    const unsellable = integer(cells[indexes.get('unsellable')!], 'Unsellable');
    const rowErrors: string[] = [];
    if (!skuCode) rowErrors.push('SKU code is required.');
    if (!warehouseCode) rowErrors.push('Warehouse code is required.');
    if (onHand.error) rowErrors.push(onHand.error);
    if (unsellable.error) rowErrors.push(unsellable.error);
    const key = `${skuCode}::${warehouseCode}`;
    if (skuCode && warehouseCode && seen.has(key)) {
      rowErrors.push('Duplicate SKU + warehouse combination in this file.');
    }
    if (!rowErrors.length) seen.add(key);
    if (rowErrors.length) {
      errors.push(`Row ${rowNumber}: ${rowErrors.join(' ')}`);
      continue;
    }
    lines.push({
      rowNumber,
      skuCode,
      warehouseCode,
      onHand: onHand.value!,
      unsellable: unsellable.value!,
    });
  }
  if (!lines.length && !errors.length) errors.push('No data rows were found.');
  return { lines, errors };
}

/** Validate rows against current SKU, warehouse, reserved and consistency constraints. */
export function validateInventoryImport(
  lines: InventoryImportLine[],
  products: Product[],
  warehouses: Warehouse[],
  inventory: InventoryBalance[]
): InventoryImportValidation {
  const rows: InventoryImportRow[] = [];
  const globalErrors: string[] = [];
  for (const line of lines) {
    const errors: string[] = [];
    let skuId: string | undefined;
    let warehouseId: string | undefined;
    let previousOnHand: number | undefined;
    let previousUnsellable: number | undefined;
    let previousAvailable: number | undefined;
    let reserved = 0;
    let nextAvailable: number | undefined;

    const product = products.find(item =>
      item.skus.some(sku => sku.sku_code.toUpperCase() === line.skuCode)
    );
    const sku = product?.skus.find(item => item.sku_code.toUpperCase() === line.skuCode);
    if (!sku) {
      errors.push(`Unknown SKU code: ${line.skuCode}.`);
    } else {
      skuId = sku.id;
      const warehouse = warehouses.find(
        item => item.code.toUpperCase() === line.warehouseCode
      );
      if (!warehouse) {
        errors.push(`Unknown warehouse code: ${line.warehouseCode}.`);
      } else {
        warehouseId = warehouse.id;
        const balance = inventory.find(
          item => item.sku_id === sku.id && item.warehouse_id === warehouse.id
        );
        if (!balance) {
          errors.push(
            'No existing inventory balance for this SKU + warehouse. Creating new balances is pending confirmation.'
          );
        } else {
          previousOnHand = balance.on_hand;
          previousUnsellable = balance.unsellable;
          previousAvailable = Math.max(
            0,
            balance.on_hand - balance.reserved - balance.unsellable
          );
          reserved = balance.reserved;
          nextAvailable = line.onHand - reserved - line.unsellable;
          if (line.unsellable > line.onHand) {
            errors.push('Unsellable quantity cannot exceed on-hand quantity.');
          }
          if (nextAvailable < 0) {
            errors.push(
              'On-hand minus unsellable is below the current reserved quantity; reserved stock cannot be overwritten.'
            );
          }
        }
      }
    }
    rows.push({
      line,
      skuId,
      warehouseId,
      previousOnHand,
      previousUnsellable,
      previousAvailable,
      reserved,
      nextAvailable,
      errors,
      valid: errors.length === 0,
    });
  }
  const valid = rows.length > 0 && rows.every(row => row.valid);
  if (!rows.length) globalErrors.push('No data rows were found.');
  return {
    rows,
    valid,
    errors: [...globalErrors, ...rows.flatMap(row => row.errors)],
    validLines: valid ? rows.map(row => row.line) : [],
  };
}

export const inventoryImportHeaders = [...HEADERS];
export const inventoryImportMaxRows = MAX_ROWS;
