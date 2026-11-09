/**
 * One whole-PCS step for the shared quantity fields. Keeps MOQ and stock
 * boundaries in one place, and treats an empty/invalid draft as the minimum.
 */
export function stepQuantity(
  value: string | number,
  delta: number,
  min: number,
  max?: number
): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  const base = Number.isFinite(parsed) ? Math.round(parsed) : min;
  const upper = max === undefined ? Number.MAX_SAFE_INTEGER : Math.max(min, max);
  return String(Math.min(upper, Math.max(min, base + delta)));
}
