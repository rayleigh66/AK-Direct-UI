/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { calculateSKUAvailableStock } from '../../utils/rules';
import {
  Boxes,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Upload,
  RefreshCw,
  Building,
} from 'lucide-react';

export const InventoryImportView: React.FC = () => {
  const { inventory, warehouses, products, excelImportStock } = useApp();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [importFeedback, setImportFeedback] = useState('');

  // Sample Excel rows for simulation (PRD D06 & T23)
  const [excelRows, setExcelRows] = useState([
    { sku_code: 'AK-9042-NAV', warehouse_code: 'WH-SH', on_hand: 120, unsellable: 0 },
    { sku_code: 'AK-9042-OLV', warehouse_code: 'WH-SH', on_hand: 50, unsellable: 0 },
    { sku_code: 'AK-7710-SLV', warehouse_code: 'WH-SH', on_hand: 180, unsellable: 5 },
    { sku_code: 'AK-8015-NVY', warehouse_code: 'WH-NB', on_hand: 150, unsellable: 0 },
  ]);

  const handleCommitImport = () => {
    const res = excelImportStock(excelRows);
    if (res.success) {
      setImportFeedback(`Excel 批量导入成功！已更新 ${res.count} 条仓库现货库存记录并记录审计日志。`);
      setIsPreviewOpen(false);
      setTimeout(() => setImportFeedback(''), 4500);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            多仓现货库存与 Excel 导入 (Inventory & Bulk Import)
          </h1>
          <p className="text-xs text-slate-500">
            公式: 可订库存 available = max(0, on_hand - reserved - unsellable) · 客户端仅展示多仓汇总
          </p>
        </div>

        <button
          onClick={() => setIsPreviewOpen(true)}
          className="min-h-[44px] px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-sm self-start sm:self-auto"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          <span>Excel 批量导入模拟 (Import Excel)</span>
        </button>
      </div>

      {importFeedback && (
        <div className="p-3 bg-emerald-900 text-emerald-100 text-xs rounded-xl flex items-center justify-between animate-in fade-in">
          <span>{importFeedback}</span>
          <button onClick={() => setImportFeedback('')} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Warehouse Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {warehouses.map(w => {
          const balances = inventory.filter(b => b.warehouse_id === w.id);
          const totalOnHand = balances.reduce((s, b) => s + b.on_hand, 0);
          const totalReserved = balances.reduce((s, b) => s + b.reserved, 0);
          const totalAvail = balances.reduce((s, b) => s + Math.max(0, b.on_hand - b.reserved - b.unsellable), 0);

          return (
            <div key={w.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">{w.name}</span>
                <span className="font-mono text-[10px] text-slate-400 px-1.5 py-0.5 bg-slate-100 rounded">{w.code}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-[10px] text-slate-400">实存 (On Hand)</div>
                  <div className="font-mono font-bold text-xs text-slate-800">{totalOnHand}</div>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-[10px] text-slate-400">预占 (Reserved)</div>
                  <div className="font-mono font-bold text-xs text-amber-600">{totalReserved}</div>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-[10px] text-slate-400">可订 (Available)</div>
                  <div className="font-mono font-bold text-xs text-emerald-700">{totalAvail}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Multi-Warehouse SKU Balance Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-slate-700" />
            <span className="text-xs font-bold text-slate-900">SKU 多仓实时库存明细</span>
          </div>
          <span className="text-xs text-slate-400">内部明细视图（客户端已屏蔽仓库明细）</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/60 text-slate-400 text-[10px] uppercase font-semibold">
              <tr>
                <th className="p-3 pl-4">款号 / SKU 编码</th>
                <th className="p-3">仓库名称</th>
                <th className="p-3 text-right">实物库存 (On-Hand)</th>
                <th className="p-3 text-right">有效预占 (Reserved)</th>
                <th className="p-3 text-right">不可销售 (Unsellable)</th>
                <th className="p-3 text-right font-bold text-slate-800">可订库存 (Available)</th>
                <th className="p-3 pr-4 text-right">最后更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inventory.map((b, idx) => {
                const wh = warehouses.find(w => w.id === b.warehouse_id);
                let skuCode = b.sku_id;
                let prodTitle = '';
                for (const p of products) {
                  const s = p.skus.find(sk => sk.id === b.sku_id);
                  if (s) {
                    skuCode = s.sku_code;
                    prodTitle = `${p.title} (${s.color_name})`;
                    break;
                  }
                }

                const available = Math.max(0, b.on_hand - b.reserved - b.unsellable);

                return (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="p-3 pl-4">
                      <div className="font-mono font-bold text-slate-900">{skuCode}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{prodTitle}</div>
                    </td>
                    <td className="p-3 text-slate-700">{wh?.name}</td>
                    <td className="p-3 text-right font-mono text-slate-800">{b.on_hand}</td>
                    <td className="p-3 text-right font-mono text-amber-600 font-semibold">{b.reserved}</td>
                    <td className="p-3 text-right font-mono text-slate-400">{b.unsellable}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-700">{available}</td>
                    <td className="p-3 pr-4 text-right font-mono text-slate-400 text-[11px]">{b.updated_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Excel Import Simulation Modal (PRD D06, T23) */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold">Excel 批量库存导入与差异预览 (Preview & Commit)</h3>
              </div>
              <button onClick={() => setIsPreviewOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1 text-slate-600">
                <div>导入模式: <strong>按仓库每 SKU 绝对库存快照覆盖 (Snapshot Mode)</strong></div>
                <div>安全校验: 自动比对有效预占，防止导入导致可订库存超卖。</div>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                    <tr>
                      <th className="p-2.5 pl-3">SKU 编码</th>
                      <th className="p-2.5">仓库代码</th>
                      <th className="p-2.5 text-right">导入实物库存</th>
                      <th className="p-2.5 text-right">不良/冻结</th>
                      <th className="p-2.5 pr-3 text-right">校验状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {excelRows.map((r, i) => (
                      <tr key={i}>
                        <td className="p-2.5 pl-3 font-mono font-bold text-slate-800">{r.sku_code}</td>
                        <td className="p-2.5 font-mono text-slate-600">{r.warehouse_code}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-indigo-700">{r.on_hand} PCS</td>
                        <td className="p-2.5 text-right font-mono text-slate-500">{r.unsellable} PCS</td>
                        <td className="p-2.5 pr-3 text-right text-emerald-700 font-semibold flex items-center justify-end gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>校验通过</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setIsPreviewOpen(false)}
                  className="flex-1 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={handleCommitImport}
                  className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>确认无误，提交导入 (Commit)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
