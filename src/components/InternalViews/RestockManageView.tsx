/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { calculateSKUAvailableStock, SKU_MOQ } from '../../utils/rules';
import {
  BellRing,
  Boxes,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Truck,
  Building,
} from 'lucide-react';

export const RestockManageView: React.FC = () => {
  const { restockRequests, inventory, companies, replenishStock, setActiveTab } = useApp();
  const [replenishSuccessMsg, setReplenishSuccessMsg] = useState('');

  const handleReplenish = (skuId: string, addQty: number) => {
    replenishStock(skuId, 'wh-sh', addQty);
    setReplenishSuccessMsg(`已完成入库 +${addQty} PCS！库存已达起订量，系统已自动向原申请客户发出站内通知并生成业务员通知邮件草稿。`);
    setTimeout(() => setReplenishSuccessMsg(''), 4500);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            客户缺货补货需求管理 (Restock Requests)
          </h1>
          <p className="text-xs text-slate-500">
            实时查看客户对缺货 SKU 提交的补货期望 · 仓库现货到仓后自动触发到货通知
          </p>
        </div>
      </div>

      {replenishSuccessMsg && (
        <div className="p-3 bg-emerald-900 text-emerald-100 text-xs rounded-xl flex items-center justify-between animate-in fade-in">
          <span>{replenishSuccessMsg}</span>
          <button onClick={() => setReplenishSuccessMsg('')} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* PRD Rule Callout */}
      <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong>PRD D09 / T24 核心规则：</strong>
          当仓库补货使指定 SKU 的可订现货恢复达到起订量 (≥10 PCS) 时，系统向提出该需求的客户发送站内通知与英文邮件模板，
          <strong>绝不自动预占锁定库存</strong>。库存分配遵循先到先确认原则。
        </div>
      </div>

      {restockRequests.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <BellRing className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h2 className="text-sm font-bold text-slate-700">暂无客户补货需求</h2>
          <p className="text-xs text-slate-400 mt-1">当客户在缺货或低库存 SKU 详情点击【申请补货】后将在此呈现。</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm divide-y divide-slate-100">
          {restockRequests.map(req => {
            const comp = companies.find(c => c.id === req.company_id);
            const { totalAvailable } = calculateSKUAvailableStock(req.sku_id, inventory);
            const isStockRestored = totalAvailable >= SKU_MOQ;

            return (
              <div key={req.id} className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {req.sku_code}
                    </span>
                    <span className="text-xs text-slate-600 font-medium">
                      {req.product_title} ({req.color_name})
                    </span>
                    {req.status === 'notified' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        已触达到货通知
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        等待到货补仓
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>
                      需求客户: <strong className="text-slate-800">{comp?.short_name}</strong> ({comp?.customer_code})
                    </span>
                    <span>·</span>
                    <span>期望采购量: <strong className="font-mono text-slate-900">{req.requested_qty} PCS</strong></span>
                    <span>·</span>
                    <span>申请时间: {req.created_at}</span>
                  </div>

                  <div className="text-xs pt-1">
                    当前多仓实无可订现货:
                    <span
                      className={`font-mono font-bold ml-1.5 ${
                        isStockRestored ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                    >
                      {totalAvailable} PCS
                    </span>
                    {isStockRestored && req.status === 'pending' && (
                      <span className="text-emerald-700 font-semibold ml-2">
                        (已恢复起订量，可触发通知)
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Action: Simulate Inbound Replenishment */}
                <div className="flex items-center gap-2 self-end md:self-center">
                  <button
                    onClick={() => handleReplenish(req.sku_id, 50)}
                    className="min-h-[44px] px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="模拟上海主仓到货 50 件入库"
                  >
                    <Plus className="w-3.5 h-3.5 text-slate-500" />
                    <span>入库 +50 PCS</span>
                  </button>

                  <button
                    onClick={() => handleReplenish(req.sku_id, 100)}
                    className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                    title="模拟上海主仓到货 100 件入库"
                  >
                    <Boxes className="w-3.5 h-3.5" />
                    <span>入库 +100 PCS 并通知客户</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
