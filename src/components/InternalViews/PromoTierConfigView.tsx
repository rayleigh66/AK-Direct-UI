/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Promotion } from '../../types';
import {
  Sparkles,
  Award,
  Plus,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react';

export const PromoTierConfigView: React.FC = () => {
  const {
    promotions,
    tierRules,
    products,
    adminAddOrUpdatePromotion,
    adminUpdateTierRule,
  } = useApp();

  // Promotion Form state
  const [selectedSkuId, setSelectedSkuId] = useState(products[0]?.skus[0]?.id || '');
  const [promoPrice, setPromoPrice] = useState(29.9);
  const [startDate, setStartDate] = useState('2026-11-01');
  const [endDate, setEndDate] = useState('2026-12-15');
  const [stackDiscount, setStackDiscount] = useState(false);
  const [promoSuccessMsg, setPromoSuccessMsg] = useState('');

  // Tier Edit states
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editThreshold, setEditThreshold] = useState<number>(0);
  const [editDiscountRate, setEditDiscountRate] = useState<number>(0);

  const handleAddPromo = (e: React.FormEvent) => {
    e.preventDefault();
    adminAddOrUpdatePromotion({
      sku_id: selectedSkuId,
      promo_price_usd: promoPrice,
      start_at: startDate,
      end_at: endDate,
      stack_tier_discount: stackDiscount,
      status: 'active',
    });

    setPromoSuccessMsg('新限时促销已配置并生效！已更新全平台对应 SKU 参考批发价。');
    setTimeout(() => setPromoSuccessMsg(''), 3000);
  };

  const handleSaveTier = (tierId: string) => {
    adminUpdateTierRule(tierId, editThreshold, editDiscountRate / 100);
    setEditingTierId(null);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-slate-900">
          限时促销与客户等级规则配置 (Promotions & Tier Framework)
        </h1>
        <p className="text-xs text-slate-500">
          PRD 7.2 促销计算与等级叠加规则 · 无 SKU 常驻特殊价格 · 历史已确认订单价格不受之后修改影响 (PRD D22)
        </p>
      </div>

      {promoSuccessMsg && (
        <div className="p-3 bg-emerald-900 text-emerald-100 text-xs rounded-xl flex items-center justify-between animate-in fade-in">
          <span>{promoSuccessMsg}</span>
          <button onClick={() => setPromoSuccessMsg('')} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Promotion Configuration Panel (PRD 7.2, D20, D21, T17, T18) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Sparkles className="w-5 h-5 text-rose-600" />
          <h2 className="text-sm font-bold text-slate-900">
            新增限时促销活动 (Time-Limited Promotion)
          </h2>
        </div>

        <form onSubmit={handleAddPromo} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                选择促销 SKU
              </label>
              <select
                value={selectedSkuId}
                onChange={e => setSelectedSkuId(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {products.flatMap(p =>
                  p.skus.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.sku_code} — {p.title} ({s.color_name}) [原价 ${s.base_price_usd}]
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                促销批发价 USD
              </label>
              <input
                type="number"
                step="0.1"
                min="1"
                value={promoPrice}
                onChange={e => setPromoPrice(parseFloat(e.target.value) || 0)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                开始生效日期
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                结束截止日期
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                required
              />
            </div>
          </div>

          {/* Stacking Rule Switch (PRD D20 & T18) */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-slate-800">
                是否叠加客户等级折扣？(Stack Customer Tier Discount)
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {stackDiscount
                  ? '已开启叠加：参考单价 = 促销 USD 价 × (1 - 客户等级折扣率)'
                  : '默认不叠加 (PRD 7.2)：参考单价 = 促销 USD 价 (一口价)'}
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={stackDiscount}
                onChange={e => setStackDiscount(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-900"></div>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="min-h-[44px] px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>发布限时促销活动</span>
            </button>
          </div>
        </form>

        {/* Existing Promotions List */}
        <div className="pt-3 border-t border-slate-100">
          <div className="text-xs font-bold text-slate-800 mb-3">当前生效的限时促销列表</div>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3 pl-4">促销 SKU</th>
                  <th className="p-3">促销价格 (USD)</th>
                  <th className="p-3">起止时间</th>
                  <th className="p-3">等级折扣叠加</th>
                  <th className="p-3 pr-4 text-right">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {promotions.map(promo => {
                  let skuName = promo.sku_id;
                  for (const p of products) {
                    const s = p.skus.find(sk => sk.id === promo.sku_id);
                    if (s) {
                      skuName = `${s.sku_code} (${s.color_name})`;
                      break;
                    }
                  }
                  return (
                    <tr key={promo.id}>
                      <td className="p-3 pl-4 font-mono font-bold text-slate-900">{skuName}</td>
                      <td className="p-3 font-mono font-bold text-rose-600">${promo.promo_price_usd.toFixed(2)}</td>
                      <td className="p-3 text-slate-600">{promo.start_at} 至 {promo.end_at}</td>
                      <td className="p-3">
                        {promo.stack_tier_discount ? (
                          <span className="text-emerald-700 font-semibold">● 开启叠加 (Stackable)</span>
                        ) : (
                          <span className="text-slate-500">不叠加 (一口促销价)</span>
                        )}
                      </td>
                      <td className="p-3 pr-4 text-right font-semibold text-emerald-700">
                        生效中 (Active)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tier Rules Framework Config (PRD 7.1) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-600" />
            <h2 className="text-sm font-bold text-slate-900">
              客户等级门槛与折扣率配置 (Customer Tier Framework)
            </h2>
          </div>
          <span className="text-xs text-slate-400">管理员可随时微调档位</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="p-3 pl-4">等级级别</th>
                <th className="p-3">等级名称</th>
                <th className="p-3 text-right">历史有效采购额门槛 (USD)</th>
                <th className="p-3 text-right">全店批发折扣率</th>
                <th className="p-3 pr-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tierRules.map(tier => {
                const isEditing = editingTierId === tier.id;
                return (
                  <tr key={tier.id} className="hover:bg-slate-50/50">
                    <td className="p-3 pl-4 font-mono font-bold text-slate-900">Tier {tier.tier_level}</td>
                    <td className="p-3 font-semibold text-slate-800">{tier.name}</td>
                    <td className="p-3 text-right font-mono">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editThreshold}
                          onChange={e => setEditThreshold(parseInt(e.target.value) || 0)}
                          className="w-28 p-1 border rounded text-right font-mono text-xs"
                        />
                      ) : (
                        `$${tier.threshold_usd.toLocaleString()}`
                      )}
                    </td>
                    <td className="p-3 text-right font-mono text-emerald-700 font-bold">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editDiscountRate}
                          onChange={e => setEditDiscountRate(parseFloat(e.target.value) || 0)}
                          className="w-16 p-1 border rounded text-right font-mono text-xs"
                        />
                      ) : (
                        `${(tier.discount_rate * 100).toFixed(0)}% OFF`
                      )}
                    </td>
                    <td className="p-3 pr-4 text-right">
                      {isEditing ? (
                        <button
                          onClick={() => handleSaveTier(tier.id)}
                          className="px-2.5 py-1 bg-slate-900 text-white rounded text-[11px] font-semibold"
                        >
                          保存
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTierId(tier.id);
                            setEditThreshold(tier.threshold_usd);
                            setEditDiscountRate(tier.discount_rate * 100);
                          }}
                          className="text-indigo-600 hover:underline font-medium"
                        >
                          编辑
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
