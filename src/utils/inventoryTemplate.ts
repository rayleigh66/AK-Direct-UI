export const INVENTORY_TEMPLATE_FILENAME = 'aoking-inventory-template.csv';
export const INVENTORY_TEMPLATE_HEADERS = [
  'sku_code',
  'warehouse_code',
  'on_hand',
  'unsellable',
] as const;

export const INVENTORY_TEMPLATE_EXAMPLE = {
  sku_code: 'EXAMPLE-SKU',
  warehouse_code: 'EXAMPLE-WH',
  on_hand: 100,
  unsellable: 0,
} as const;

/**
 * One clearly fake example row explains the shape without being importable:
 * the server rejects the unknown EXAMPLE-SKU/EXAMPLE-WH on preview, so a
 * download can never write stock by itself.
 */
export const INVENTORY_TEMPLATE_CSV = `${INVENTORY_TEMPLATE_HEADERS.join(',')}\n${INVENTORY_TEMPLATE_EXAMPLE.sku_code},${INVENTORY_TEMPLATE_EXAMPLE.warehouse_code},${INVENTORY_TEMPLATE_EXAMPLE.on_hand},${INVENTORY_TEMPLATE_EXAMPLE.unsellable}\n`;

export const INVENTORY_TEMPLATE_COLUMNS = [
  { key: 'sku_code', en: 'SKU code', zh: 'SKU 编码' },
  { key: 'warehouse_code', en: 'Warehouse code', zh: '仓库编码' },
  { key: 'on_hand', en: 'On-hand quantity', zh: '在手数量' },
  { key: 'unsellable', en: 'Unsellable quantity', zh: '不可售数量' },
] as const;

export function downloadInventoryTemplate(): void {
  const blob = new Blob([INVENTORY_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = INVENTORY_TEMPLATE_FILENAME;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
