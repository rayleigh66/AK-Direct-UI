/** Compact cart badge count; the cart itself always shows the exact PCS. */
export function formatCartBadge(totalQuantity: number): string {
  if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) return '0';
  return totalQuantity > 99 ? '99+' : String(Math.floor(totalQuantity));
}
