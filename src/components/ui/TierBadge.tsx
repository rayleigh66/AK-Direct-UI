import React from 'react';
import type { TierRule } from '../../types';

const TIERS: Record<
  number,
  { label: string; zh: string; className: string; dot: string }
> = {
  1: {
    label: 'Bronze',
    zh: '青铜',
    className: 'border-amber-300 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
  },
  2: {
    label: 'Silver',
    zh: '白银',
    className: 'border-slate-300 bg-slate-100 text-slate-700',
    dot: 'bg-slate-400',
  },
  3: {
    label: 'Gold',
    zh: '黄金',
    className: 'border-yellow-300 bg-yellow-50 text-yellow-800',
    dot: 'bg-yellow-500',
  },
  4: {
    label: 'Platinum',
    zh: '铂金',
    className: 'border-cyan-300 bg-cyan-50 text-cyan-800',
    dot: 'bg-cyan-500',
  },
  5: {
    label: 'Diamond',
    zh: '钻石',
    className: 'border-violet-300 bg-violet-50 text-violet-800',
    dot: 'bg-violet-500',
  },
};

interface TierBadgeProps {
  tier: TierRule | undefined;
  testId?: string;
  language?: 'en' | 'zh';
}

/**
 * Customer-level tag driven only by the existing tier rule level. No tier is
 * inferred or invented when the rule is missing.
 */
export const TierBadge: React.FC<TierBadgeProps> = ({ tier, testId, language = 'en' }) => {
  if (!tier) return null;
  const meta = TIERS[tier.tier_level];
  if (!meta) return null;
  return (
    <span
      data-testid={testId}
      data-tier-level={tier.tier_level}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold leading-4 ${meta.className}`}
      title={`${meta.zh} / ${meta.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {language === 'zh' ? meta.zh : meta.label}
    </span>
  );
};
