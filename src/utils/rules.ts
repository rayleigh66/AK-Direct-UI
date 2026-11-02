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
  currentDate: string = '2026-11-01'
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
