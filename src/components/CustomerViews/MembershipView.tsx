/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { customerStatus, customerTierName } from '../../utils/customerDisplay';
import {
  Award,
  TrendingUp,
  AlertCircle,
  Clock,
  Sparkles,
  ShieldCheck,
  Building2,
  Calendar,
  FastForward,
} from 'lucide-react';

export const MembershipView: React.FC = () => {
  const {
    currentCompany,
    currentCompanyTierInfo,
    tierRules,
    orders,
    simulateTimeTravelInactivity,
    salesRecordPayment,
  } = useApp();

  if (!currentCompany || !currentCompanyTierInfo) {
    return null;
  }

  const {
    baseTier,
    currentTier,
    downgradeCount,
    nextTier,
    spendGapToNextTier,
    monthsToNextDowngrade,
  } = currentCompanyTierInfo;

  // Platform orders for this company (D19)
  const companyOrders = orders.filter(o => o.company_id === currentCompany.id);

  // Progress percentage to next tier
  const currentThreshold = baseTier.threshold_usd;
  const nextThreshold = nextTier ? nextTier.threshold_usd : currentThreshold * 1.5;
  const progressPercent = Math.min(
    100,
    Math.max(0, ((currentCompany.cumulative_spend_usd - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-24">
      {/* Header Profile Box */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 text-amber-400 flex items-center justify-center shrink-0 shadow-md">
            <Award className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">{currentCompany.short_name}</h1>
              <span className="font-mono text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-semibold">
                {currentCompany.customer_code}
              </span>
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-semibold">
                {currentCompany.country_alpha3}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Company accounts share one tier and discount · Pricing currency: USD
            </p>
          </div>
        </div>

        {/* Current Active Tier Badge */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-right self-start md:self-auto min-w-[200px]">
          <div className="text-[11px] text-slate-400">Current tier / discount</div>
          <div className="text-base font-extrabold text-slate-900 flex items-center justify-end gap-1.5 mt-0.5">
            <span>{customerTierName(currentTier)}</span>
          </div>
          <div className="text-emerald-700 font-bold text-sm font-mono mt-0.5">
            Regular catalog price -{(currentTier.discount_rate * 100).toFixed(0)}% OFF
          </div>
        </div>
      </div>

      {/* Spend Progress Bar & Tier Scale */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-500">Historical cumulative spend</div>
            <div className="text-2xl font-black font-mono text-slate-900 mt-0.5 tabular-nums">
              USD ${currentCompany.cumulative_spend_usd.toLocaleString()}
            </div>
          </div>

          {nextTier ? (
            <div className="text-xs text-slate-600">
              Spend needed for <strong>{customerTierName(nextTier)}</strong>:
              <span className="font-mono font-bold text-indigo-700 ml-1">
                USD ${spendGapToNextTier.toLocaleString()}
              </span>
            </div>
          ) : (
            <div className="text-xs text-emerald-700 font-bold">
              ★ Highest AOKING partner tier reached
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-slate-900 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Current base tier threshold: ${baseTier.threshold_usd.toLocaleString()}</span>
            {nextTier && <span>Next tier threshold: ${nextTier.threshold_usd.toLocaleString()}</span>}
          </div>
        </div>

        {/* Tier Ladder Table */}
        <div className="pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-700 mb-3">Tier framework</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {tierRules.map(rule => {
              const isBase = baseTier.id === rule.id;
              const isCurrent = currentTier.id === rule.id;
              return (
                <div
                  key={rule.id}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    isCurrent
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : isBase
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="font-bold text-xs">{customerTierName(rule)}</div>
                  <div className="font-mono text-[11px] mt-1">
                    ≥ ${rule.threshold_usd.toLocaleString()}
                  </div>
                  <div
                    className={`text-xs font-bold font-mono mt-1 ${
                      isCurrent ? 'text-amber-300' : 'text-emerald-700'
                    }`}
                  >
                    -{(rule.discount_rate * 100).toFixed(0)}% OFF
                  </div>
                  {isCurrent && (
                    <div className="text-[10px] mt-1 bg-white/20 rounded py-0.5">Current</div>
                  )}
                  {isBase && !isCurrent && (
                    <div className="text-[10px] mt-1 text-rose-600 font-semibold">Base tier (downgraded)</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Inactivity Downgrade Engine (PRD 7.1 / D18 / T21 Interactive Demo) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Inactivity downgrade</h2>
          </div>
          <span className="text-[11px] text-slate-400">PRD 7.1 rule</span>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-slate-400">Last effective purchase:</div>
            <div className="font-mono font-bold text-slate-800 text-sm mt-0.5">
              {currentCompany.last_effective_purchase_date}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Based on recorded full payment, not order submission
            </div>
          </div>

          <div>
            <div className="text-slate-400">Months inactive:</div>
            <div className="font-mono font-bold text-slate-900 text-sm mt-0.5">
              {currentCompany.months_inactive} months
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {currentCompany.months_inactive < 18
                ? 'Normal: no downgrade before 18 months'
                : `Downgrade threshold reached: down ${downgradeCount} tier(s)`}
            </div>
          </div>

          <div>
            <div className="text-slate-400">Downgrade status:</div>
            <div className="font-bold text-sm mt-0.5">
              {downgradeCount > 0 ? (
                <span className="text-rose-600">Downgraded (-{downgradeCount} tier)</span>
              ) : (
                <span className="text-emerald-700">No downgrade yet · {monthsToNextDowngrade} months to first downgrade</span>
              )}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              First downgrade at 18 months, then every 12 months
            </div>
          </div>
        </div>

        {/* Rule Card */}
        <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span>How tier changes work:</span>
          </div>
          <p>
            1. <strong>Base tier</strong> is calculated from historical cumulative effective purchases;
            2. <strong>First downgrade at 18 months</strong>, another at 30 months, then every 12 months down to the lowest tier;
            3. <strong>New purchase:</strong> after a new full payment is recorded, the tier is recalculated and the inactivity timer resets immediately.
          </p>
        </div>

        {/* Interactive Time-Travel Simulation for Scenario T21 */}
        <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <FastForward className="w-4 h-4" />
              <span>Inactivity fast-forward (Demo)</span>
            </div>
            <span className="text-[10px] text-slate-400">Adjust the demo inactivity clock</span>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 6)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              +6 months
            </button>
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 12)}
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-colors"
            >
              +12 months
            </button>
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 18)}
              className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40 transition-colors"
            >
              +18 months (first downgrade)
            </button>
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 30)}
              className="px-3 py-1.5 rounded-lg bg-rose-500/30 text-rose-300 hover:bg-rose-500/40 border border-rose-500/50 transition-colors"
            >
              +30 months (two downgrades)
            </button>

            <button
              onClick={() => {
                // simulate a $5,000 purchase to restore
                salesRecordPayment('SIM-RESTORE', 5000, 'WIRE-SIM-RESTORE');
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors ml-auto flex items-center gap-1"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Record $5,000 purchase · restore tier and reset timer</span>
            </button>
          </div>
        </div>
      </div>

      {/* Platform Orders Summary (D19) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Platform order history</h2>
          </div>
          <span className="text-xs text-slate-400">{companyOrders.length} orders</span>
        </div>

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-500">
          <strong>Data scope:</strong> platform order lines and historical cumulative spend are visible to your company.
          <strong>Offline historical order lines are not displayed.</strong> Offline purchases registered by sales are included in the cumulative total.
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 text-[10px] uppercase font-semibold">
              <tr>
                <th className="p-3 pl-4">Order number</th>
                <th className="p-3">Submitted</th>
                <th className="p-3">Account</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">PCS</th>
                <th className="p-3 pr-4 text-right">Amount (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companyOrders.map(o => (
                <tr key={o.id} className="hover:bg-slate-50/50">
                  <td className="p-3 pl-4 font-mono font-bold text-slate-900">{o.order_no}</td>
                  <td className="p-3 text-slate-500">{o.created_at.slice(0, 10)}</td>
                  <td className="p-3 font-mono text-slate-700">{o.created_by_username}</td>
                  <td className="p-3">
                    <span className="font-semibold text-slate-800">{customerStatus(o.status)}</span>
                  </td>
                  <td className="p-3 text-right font-mono text-slate-700">
                    {o.lines.reduce((s, l) => s + l.quantity, 0)}
                  </td>
                  <td className="p-3 pr-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                    ${(o.total_confirmed_usd || o.total_quoted_usd).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
