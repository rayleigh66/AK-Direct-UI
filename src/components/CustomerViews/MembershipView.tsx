/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
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
    <div className="max-w-5xl mx-auto space-y-6 pb-24">
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
              公司独立账号共享等级与折扣 · 计价基准货币: USD
            </p>
          </div>
        </div>

        {/* Current Active Tier Badge */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-right self-start md:self-auto min-w-[200px]">
          <div className="text-[11px] text-slate-400">当前执行等级 / 折扣</div>
          <div className="text-base font-extrabold text-slate-900 flex items-center justify-end gap-1.5 mt-0.5">
            <span>{currentTier.name}</span>
          </div>
          <div className="text-emerald-700 font-bold text-sm font-mono mt-0.5">
            全店常规单价 -{(currentTier.discount_rate * 100).toFixed(0)}% OFF
          </div>
        </div>
      </div>

      {/* Spend Progress Bar & Tier Scale */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-500">历史累计有效采购额 (Historical Cumulative Spend)</div>
            <div className="text-2xl font-black font-mono text-slate-900 mt-0.5 tabular-nums">
              USD ${currentCompany.cumulative_spend_usd.toLocaleString()}
            </div>
          </div>

          {nextTier ? (
            <div className="text-xs text-slate-600">
              距升级下一档 <strong>{nextTier.name}</strong> 仍需有效采购:
              <span className="font-mono font-bold text-indigo-700 ml-1">
                USD ${spendGapToNextTier.toLocaleString()}
              </span>
            </div>
          ) : (
            <div className="text-xs text-emerald-700 font-bold">
              ★ 已达到 AOKING 最高伙伴等级
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
            <span>当前基础等级门槛: ${baseTier.threshold_usd.toLocaleString()}</span>
            {nextTier && <span>下一等级门槛: ${nextTier.threshold_usd.toLocaleString()}</span>}
          </div>
        </div>

        {/* Tier Ladder Table */}
        <div className="pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-700 mb-3">等级梯队标准 (Tier Framework)</div>
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
                  <div className="font-bold text-xs">{rule.name}</div>
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
                    <div className="text-[10px] mt-1 bg-white/20 rounded py-0.5">当前生效</div>
                  )}
                  {isBase && !isCurrent && (
                    <div className="text-[10px] mt-1 text-rose-600 font-semibold">基础等级 (降级中)</div>
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
            <h2 className="text-sm font-bold text-slate-900">未采购降级计时器 (Inactivity Downgrade Engine)</h2>
          </div>
          <span className="text-[11px] text-slate-400">PRD 7.1 算法已确认</span>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-slate-400">最近一次有效采购日期:</div>
            <div className="font-mono font-bold text-slate-800 text-sm mt-0.5">
              {currentCompany.last_effective_purchase_date}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              以实际完成付款登记为准 (非下单提交)
            </div>
          </div>

          <div>
            <div className="text-slate-400">未采购已累计时长:</div>
            <div className="font-mono font-bold text-slate-900 text-sm mt-0.5">
              {currentCompany.months_inactive} 个月
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {currentCompany.months_inactive < 18
                ? '状态正常：未满 18 个月暂不降级'
                : `已满降级门槛：当前已下调 ${downgradeCount} 级`}
            </div>
          </div>

          <div>
            <div className="text-slate-400">降级状态说明:</div>
            <div className="font-bold text-sm mt-0.5">
              {downgradeCount > 0 ? (
                <span className="text-rose-600">降级中 (-{downgradeCount} 级)</span>
              ) : (
                <span className="text-emerald-700">未发生降级 (距首降还剩 {monthsToNextDowngrade} 个月)</span>
              )}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              满18月首次降1级，其后每满12月再降1级
            </div>
          </div>
        </div>

        {/* Rule Card */}
        <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span>PRD 7.1 降级与定级恢复规则：</span>
          </div>
          <p>
            1. <strong>基础等级</strong>按历史累计有效采购额计算；
            2. 距最近有效采购<strong>满 18 个月首次降低一级</strong>；满 30 个月再降一级；此后每满 12 个月再降一级直至最低等级；
            3. <strong>恢复采购</strong>：客户完成新有效采购付款后，系统按更新后的累计采购额重新定级，并<strong>立即重置未采购计时</strong>！
          </p>
        </div>

        {/* Interactive Time-Travel Simulation for Scenario T21 */}
        <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <FastForward className="w-4 h-4" />
              <span>验收场景 T21 模拟测试控制台 (Inactivity Fast-Forward Simulator)</span>
            </div>
            <span className="text-[10px] text-slate-400">实时调整未采购月数</span>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 6)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              +6 个月 (未达 18m)
            </button>
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 12)}
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-colors"
            >
              +12 个月
            </button>
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 18)}
              className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40 transition-colors"
            >
              +18 个月 (触发首降 1 级)
            </button>
            <button
              onClick={() => simulateTimeTravelInactivity(currentCompany.id, 30)}
              className="px-3 py-1.5 rounded-lg bg-rose-500/30 text-rose-300 hover:bg-rose-500/40 border border-rose-500/50 transition-colors"
            >
              +30 个月 (触发累降 2 级)
            </button>

            <button
              onClick={() => {
                // simulate a $5,000 purchase to restore
                salesRecordPayment('SIM-RESTORE', 5000, 'WIRE-SIM-RESTORE');
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors ml-auto flex items-center gap-1"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>新采购登记 ($5,000) 恢复定级并重置计时</span>
            </button>
          </div>
        </div>
      </div>

      {/* Platform Orders Summary (D19) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">平台采购订单记录 (Platform Orders)</h2>
          </div>
          <span className="text-xs text-slate-400">共 {companyOrders.length} 笔订单</span>
        </div>

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-500">
          <strong>数据边界提示 (PRD D19):</strong> 客户可见平台订单明细与历史累计有效采购额；根据规范，
          <strong>平台不展示线下历史订单明细</strong>。线下历史采购已由业务员登记并纳入历史有效采购总额。
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 text-[10px] uppercase font-semibold">
              <tr>
                <th className="p-3 pl-4">订单编号</th>
                <th className="p-3">下单日期</th>
                <th className="p-3">下单账号</th>
                <th className="p-3">订单状态</th>
                <th className="p-3 text-right">件数</th>
                <th className="p-3 pr-4 text-right">金额 (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companyOrders.map(o => (
                <tr key={o.id} className="hover:bg-slate-50/50">
                  <td className="p-3 pl-4 font-mono font-bold text-slate-900">{o.order_no}</td>
                  <td className="p-3 text-slate-500">{o.created_at.slice(0, 10)}</td>
                  <td className="p-3 font-mono text-slate-700">{o.created_by_username}</td>
                  <td className="p-3">
                    <span className="font-semibold text-slate-800">{o.status}</span>
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
