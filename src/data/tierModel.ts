import type { TierRule } from '../types';

/**
 * The approved five-level customer tier model. This is a shared, read-only
 * source for the Mock rules and the Real preview UI; it is not a new pricing
 * policy or a persistence contract.
 */
export const APPROVED_TIER_RULES: TierRule[] = [
  {
    id: 'tier-1',
    tier_level: 1,
    name: 'Tier 1 基础批发 (Bronze)',
    name_en: 'Tier 1 Standard (Bronze)',
    threshold_usd: 0,
    discount_rate: 0,
  },
  {
    id: 'tier-2',
    tier_level: 2,
    name: 'Tier 2 银牌批发 (Silver)',
    name_en: 'Tier 2 Silver',
    threshold_usd: 10_000,
    discount_rate: 0.05,
  },
  {
    id: 'tier-3',
    tier_level: 3,
    name: 'Tier 3 金牌伙伴 (Gold)',
    name_en: 'Tier 3 Gold Partner',
    threshold_usd: 50_000,
    discount_rate: 0.1,
  },
  {
    id: 'tier-4',
    tier_level: 4,
    name: 'Tier 4 铂金核心 (Platinum)',
    name_en: 'Tier 4 Platinum Core',
    threshold_usd: 150_000,
    discount_rate: 0.15,
  },
  {
    id: 'tier-5',
    tier_level: 5,
    name: 'Tier 5 钻石分销 (Diamond)',
    name_en: 'Tier 5 Diamond Distributor',
    threshold_usd: 350_000,
    discount_rate: 0.2,
  },
];

export const MAX_APPROVED_DISCOUNT_RATE = Math.max(
  ...APPROVED_TIER_RULES.map(rule => rule.discount_rate)
);
