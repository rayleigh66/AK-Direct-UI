export const INVENTORY_TEMPLATE_FILENAME = 'aoking-inventory-template.csv';
export const INVENTORY_TEMPLATE_HEADERS = [
  'sku_code',
  'warehouse_code',
  'on_hand',
  'unsellable',
] as const;

/** Header-only so a filled copy cannot be mistaken for committed stock. */
export const INVENTORY_TEMPLATE_CSV = `${INVENTORY_TEMPLATE_HEADERS.join(',')}\n`;

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
