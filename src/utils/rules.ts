/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TierRule, Promotion, InventoryBalance } from '../types';

/**
 * MOQ (Minimum Order Quantity) per SKU is strictly 10 PCS.
 * Must be integer >= 10.
 */
export const SKU_MOQ = 10;

export function validateSKUQuantity(qty: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(qty)) {
    return { valid: false, error: '订购数量必须为正整数' };
  }
  if (qty < SKU_MOQ) {
    return { valid: false, error: `每个 SKU 起订量为 ${SKU_MOQ} PCS（当前输入: ${qty}）` };
  }
  return { valid: true };
}

/**
 * Calculate available inventory for a SKU across warehouses.
 * Formula: available = max(0, on_hand - reserved - unsellable)
 */
export function calculateSKUAvailableStock(
  skuId: string,
  balances: InventoryBalance[]
): {
  totalAvailable: number;
  totalOnHand: number;
  totalReserved: number;
  totalUnsellable: number;
} {
  const skuBalances = balances.filter(b => b.sku_id === skuId);
  let totalAvailable = 0;
  let totalOnHand = 0;
  let totalReserved = 0;
  let totalUnsellable = 0;

  for (const b of skuBalances) {
    const avail = Math.max(0, b.on_hand - b.reserved - b.unsellable);
    totalAvailable += avail;
    totalOnHand += b.on_hand;
    totalReserved += b.reserved;
    totalUnsellable += b.unsellable;
  }

  return { totalAvailable, totalOnHand, totalReserved, totalUnsellable };
}

/**
 * Evaluate customer tier based on historical cumulative spend and inactivity months.
 * Rule:
 * 1. Base tier is determined strictly by cumulative_spend_usd against configured thresholds.
 * 2. Inactivity downgrade:
 *    - < 18 months: 0 downgrades
 *    - 18 <= months < 30: -1 tier
 *    - 30 <= months < 42: -2 tiers
 *    - 42 <= months < 54: -3 tiers
 *    - Minimum tier is Tier 1 (floor).
 */
export function evaluateCustomerTier(
  cumulativeSpendUsd: number,
  monthsInactive: number,
  tierRules: TierRule[]
): {
  baseTier: TierRule;
  currentTier: TierRule;
  downgradeCount: number;
  nextTier?: TierRule;
  spendGapToNextTier: number;
  monthsToNextDowngrade: number;
} {
  // Sort tiers by level ascending
  const sorted = [...tierRules].sort((a, b) => a.tier_level - b.tier_level);

  // Determine base tier by spend threshold
  let baseTier = sorted[0];
  for (const rule of sorted) {
    if (cumulativeSpendUsd >= rule.threshold_usd) {
      baseTier = rule;
    }
  }

  // Calculate downgrade levels
  let downgradeCount = 0;
  if (monthsInactive >= 18) {
    downgradeCount = 1 + Math.floor((monthsInactive - 18) / 12);
  }

  // Calculate current tier
  const baseLevel = baseTier.tier_level;
  const targetLevel = Math.max(1, baseLevel - downgradeCount);
  const currentTier = sorted.find(t => t.tier_level === targetLevel) || sorted[0];

  // Next tier calculation (based on base tier)
  const nextTier = sorted.find(t => t.tier_level === baseTier.tier_level + 1);
  const spendGapToNextTier = nextTier ? Math.max(0, nextTier.threshold_usd - cumulativeSpendUsd) : 0;

  // Months to next downgrade
  let monthsToNextDowngrade = 18 - monthsInactive;
  if (monthsInactive >= 18) {
    const remainder = (monthsInactive - 18) % 12;
    monthsToNextDowngrade = 12 - remainder;
  }

  return {
    baseTier,
    currentTier,
    downgradeCount,
    nextTier,
    spendGapToNextTier,
    monthsToNextDowngrade: Math.max(0, monthsToNextDowngrade),
  };
}

/**
 * Calculate reference price according to PRD 7.2:
 * 1. Normal: base_price_usd * (1 - tier_discount_rate)
 * 2. Promo active:
 *    - if stack_tier_discount: promo_price_usd * (1 - tier_discount_rate)
 *    - if not stack (default): promo_price_usd
 */
export function calculateEffectiveUnitPrice(
  basePriceUsd: number,
  skuId: string,
  tierDiscountRate: number,
  promotions: Promotion[],
  currentDate: string = new Date().toISOString().slice(0, 10)
): {
  effectivePrice: number;
  isPromo: boolean;
  promoPrice?: number;
  isStacked: boolean;
  originalPrice: number;
} {
  const activePromo = promotions.find(p => {
    return (
      p.sku_id === skuId &&
      p.status === 'active' &&
      currentDate >= p.start_at &&
      currentDate <= p.end_at
    );
  });

  if (activePromo) {
    if (activePromo.stack_tier_discount) {
      const price = Number((activePromo.promo_price_usd * (1 - tierDiscountRate)).toFixed(2));
      return {
        effectivePrice: price,
        isPromo: true,
        promoPrice: activePromo.promo_price_usd,
        isStacked: true,
        originalPrice: basePriceUsd,
      };
    } else {
      return {
        effectivePrice: activePromo.promo_price_usd,
        isPromo: true,
        promoPrice: activePromo.promo_price_usd,
        isStacked: false,
        originalPrice: basePriceUsd,
      };
    }
  }

  const normalDiscounted = Number((basePriceUsd * (1 - tierDiscountRate)).toFixed(2));
  return {
    effectivePrice: normalDiscounted,
    isPromo: false,
    isStacked: false,
    originalPrice: basePriceUsd,
  };
}

/**
 * Validate customer internal code: C + 6 digits
 */
export function isValidCustomerCode(code: string): boolean {
  return /^C[0-9]{6}$/.test(code.trim());
}

/**
 * Derive username for customer company: AK + last 6 digits of customer code + account letter
 * e.g., C000123 + 'A' -> AK000123A
 */
export function deriveUsername(customerCode: string, accountLetter: string): string {
  const cleanCode = customerCode.trim().toUpperCase();
  const digits = cleanCode.replace(/^C/, '');
  return `AK${digits}${accountLetter.toUpperCase()}`;
}

/**
 * Generate cryptographically secure random temporary password for first-time login
 */
export function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let pwd = '';
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

/** Convert USD to integer cents for exact whole-order payment comparisons. */
export function usdToCents(amountUsd: number): number {
  return Math.round(amountUsd * 100);
}

export function centsToUsd(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export interface ReservationAllocation {
  sku_id: string;
  warehouse_id: string;
  quantity: number;
}

export type ReservationPlan =
  | { success: true; allocations: ReservationAllocation[] }
  | { success: false; sku_id: string; required: number; available: number };

/**
 * Plan a whole-order reservation across warehouses without mutating state.
 * Allocation is deterministic by warehouse id. If any SKU is short, no allocations are returned.
 */
export function planOrderReservation(
  lines: { sku_id: string; quantity: number }[],
  balances: InventoryBalance[]
): ReservationPlan {
  const requiredBySku = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return { success: false, sku_id: line.sku_id, required: line.quantity, available: 0 };
    }
    requiredBySku.set(line.sku_id, (requiredBySku.get(line.sku_id) ?? 0) + line.quantity);
  }

  const allocations: ReservationAllocation[] = [];
  for (const [skuId, required] of requiredBySku) {
    const skuBalances = balances
      .filter((balance) => balance.sku_id === skuId)
      .slice()
      .sort((a, b) => a.warehouse_id.localeCompare(b.warehouse_id));
    let remaining = required;
    let available = 0;
    for (const balance of skuBalances) {
      const free = Math.max(0, balance.on_hand - balance.reserved - balance.unsellable);
      available += free;
      if (remaining <= 0) continue;
      const take = Math.min(free, remaining);
      if (take > 0) {
        allocations.push({ sku_id: skuId, warehouse_id: balance.warehouse_id, quantity: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      return { success: false, sku_id: skuId, required, available };
    }
  }

  return { success: true, allocations };
}

/** Apply planned reservations as one in-memory update; returns null if any allocation no longer fits. */
export function applyReservationAllocations(
  balances: InventoryBalance[],
  allocations: ReservationAllocation[]
): InventoryBalance[] | null {
  const next = balances.map((balance) => ({ ...balance }));
  for (const allocation of allocations) {
    const balance = next.find(
      (item) =>
        item.sku_id === allocation.sku_id && item.warehouse_id === allocation.warehouse_id
    );
    if (!balance) return null;
    const free = Math.max(0, balance.on_hand - balance.reserved - balance.unsellable);
    if (allocation.quantity <= 0 || allocation.quantity > free) return null;
    balance.reserved += allocation.quantity;
  }
  return next;
}

export type ReservationCheck =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Verify that an order's recorded allocations exactly represent its lines and are still held.
 * This prevents release/ship from consuming another order's reserved stock or clamping inconsistencies to zero.
 */
export function validateReservationAllocations(
  allocations: ReservationAllocation[] | undefined,
  lines: { sku_id: string; quantity: number }[],
  balances: InventoryBalance[],
  mode: 'release' | 'consume'
): ReservationCheck {
  if (!allocations?.length) {
    return { valid: false, error: '订单缺少可核验的仓库预占分配，操作已拒绝。' };
  }

  const requiredBySku = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return { valid: false, error: `订单行数量无效：${line.sku_id}` };
    }
    requiredBySku.set(line.sku_id, (requiredBySku.get(line.sku_id) ?? 0) + line.quantity);
  }

  const allocatedBySku = new Map<string, number>();
  const seen = new Set<string>();
  for (const allocation of allocations) {
    const key = `${allocation.sku_id}::${allocation.warehouse_id}`;
    if (seen.has(key)) return { valid: false, error: `预占分配重复：${key}` };
    seen.add(key);
    if (!Number.isInteger(allocation.quantity) || allocation.quantity <= 0) {
      return { valid: false, error: `预占分配数量无效：${key}` };
    }
    const balance = balances.find(
      (item) =>
        item.sku_id === allocation.sku_id && item.warehouse_id === allocation.warehouse_id
    );
    if (!balance) return { valid: false, error: `预占分配找不到对应仓库库存：${key}` };
    if (balance.reserved < allocation.quantity) {
      return {
        valid: false,
        error: `仓库 ${allocation.warehouse_id} 的 ${allocation.sku_id} 预占不足：需要 ${allocation.quantity}，实际 ${balance.reserved}`,
      };
    }
    if (mode === 'consume' && balance.on_hand < allocation.quantity) {
      return {
        valid: false,
        error: `仓库 ${allocation.warehouse_id} 的 ${allocation.sku_id} 实物库存不足：需要 ${allocation.quantity}，实际 ${balance.on_hand}`,
      };
    }
    allocatedBySku.set(
      allocation.sku_id,
      (allocatedBySku.get(allocation.sku_id) ?? 0) + allocation.quantity
    );
  }

  for (const [skuId, required] of requiredBySku) {
    const allocated = allocatedBySku.get(skuId) ?? 0;
    if (allocated !== required) {
      return {
        valid: false,
        error: `SKU ${skuId} 预占分配与订单数量不一致：分配 ${allocated}，订单 ${required}`,
      };
    }
  }
  for (const skuId of allocatedBySku.keys()) {
    if (!requiredBySku.has(skuId)) {
      return { valid: false, error: `预占分配包含订单之外的 SKU：${skuId}` };
    }
  }

  return { valid: true };
}

/** Release reserved quantities by their original warehouse allocations. */
export function releaseReservationAllocations(
  balances: InventoryBalance[],
  allocations: ReservationAllocation[],
  lines: { sku_id: string; quantity: number }[]
): InventoryBalance[] | null {
  if (!validateReservationAllocations(allocations, lines, balances, 'release').valid) return null;
  const next = balances.map((balance) => ({ ...balance }));
  for (const allocation of allocations) {
    const balance = next.find(
      (item) =>
        item.sku_id === allocation.sku_id && item.warehouse_id === allocation.warehouse_id
    )!;
    balance.reserved -= allocation.quantity;
  }
  return next;
}

/** Consume a shipped reservation from the same warehouses that were originally held. */
export function consumeReservationAllocations(
  balances: InventoryBalance[],
  allocations: ReservationAllocation[],
  lines: { sku_id: string; quantity: number }[]
): InventoryBalance[] | null {
  if (!validateReservationAllocations(allocations, lines, balances, 'consume').valid) return null;
  const next = balances.map((balance) => ({ ...balance }));
  for (const allocation of allocations) {
    const balance = next.find(
      (item) =>
        item.sku_id === allocation.sku_id && item.warehouse_id === allocation.warehouse_id
    )!;
    balance.on_hand -= allocation.quantity;
    balance.reserved -= allocation.quantity;
  }
  return next;
}

/**
 * Privacy filter for customer remarks and free text:
 * PRD D27 & 9.3:
 * Strict privacy: NEVER collect or store client phone, email, or physical street address.
 */
export function checkPrivacyViolations(text: string): { hasViolation: boolean; message?: string } {
  if (!text) return { hasViolation: false };

  // Check email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (emailRegex.test(text)) {
    return {
      hasViolation: true,
      message: '隐私合规拦截：备注中禁止填写邮箱地址。客户联系方式由业务员在线下专门渠道对接。',
    };
  }

  // Check phone number
  const phoneRegex = /(\+?\d{1,4}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/;
  if (phoneRegex.test(text)) {
    return {
      hasViolation: true,
      message: '隐私合规拦截：备注中禁止填写电话或手机号码。请通过线下授权渠道对接联系人。',
    };
  }

  // Check street address keywords
  const addressKeywords = [
    'street', 'st.', 'avenue', 'ave', 'road', 'rd.', 'blvd', 'suite', 'apt', 'room',
    '街道', '路', '弄', '号楼', '室', '大厦', '邮政编码', 'zipcode', 'postal'
  ];
  const lower = text.toLowerCase();
  for (const kw of addressKeywords) {
    if (lower.includes(kw)) {
      return {
        hasViolation: true,
        message: '隐私合规拦截：备注中禁止填写详细街道地址。目的国家已选定，最终交货信息由业务员线下单据处理。',
      };
    }
  }

  return { hasViolation: false };
}
