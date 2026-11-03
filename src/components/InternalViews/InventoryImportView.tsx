import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { AccessBoundary } from '../AccessBoundary';
import { calculateSKUAvailableStock } from '../../utils/rules';
import {
  Boxes,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Upload,
  Download,
  X,
  FileDown,
} from 'lucide-react';
import {
  inventoryImportHeaders,
  parseCsv,
  parseInventoryTable,
  validateInventoryImport,
  type InventoryImportValidation,
} from '../../utils/inventoryImport';

export const InventoryImportView: React.FC = () => {
  const { currentRole, inventory, warehouses, products, excelImportStock } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [validation, setValidation] = useState<InventoryImportValidation | null>(null);
  const [importFeedback, setImportFeedback] = useState('');
  const [importError, setImportError] = useState('');

  const previewErrors = useMemo(
    () => [...parseErrors, ...(validation?.errors ?? [])],
    [parseErrors, validation]
  );
  const canCommit = !!validation?.valid && previewErrors.length === 0;

  if (currentRole !== 'admin') {
    return (
      <AccessBoundary
        title="库存导入仅对管理员开放"
        message="业务员不能执行库存导入。业务员查看库存的只读权限差异尚未确认，因此本 Demo 不自行扩大授权；正式权限需由后端按角色与客户范围校验。"
      />
    );
  }

  const resetImport = () => {
    setFileName('');
    setParseErrors([]);
    setValidation(null);
    setIsPreviewOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadTemplate = () => {
    const header = inventoryImportHeaders.join(',');
    const rows = inventory.map(balance => {
      let skuCode = balance.sku_id;
      for (const product of products) {
        const sku = product.skus.find(item => item.id === balance.sku_id);
        if (sku) {
          skuCode = sku.sku_code;
          break;
        }
      }
      const warehouse = warehouses.find(item => item.id === balance.warehouse_id);
      return [skuCode, warehouse?.code ?? balance.warehouse_id, balance.on_hand, balance.unsellable]
        .map(value => `"${String(value).replaceAll('"', '""')}"`)
        .join(',');
    });
    const csv = `﻿${[header, ...rows].join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'aoking-inventory-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const readFileRows = async (file: File): Promise<unknown[][]> => {
    if (file.name.toLowerCase().endsWith('.csv')) {
      return parseCsv(await file.text());
    }
    const module = await import('read-excel-file/browser');
    return (await module.readSheet(file)) as unknown[][];
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportFeedback('');
    setParseErrors([]);
    setValidation(null);
    setFileName(file.name);
    if (file.size > 1024 * 1024) {
      setParseErrors(['File is larger than the 1 MB Demo limit.']);
      setIsPreviewOpen(true);
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setParseErrors(['Choose a .csv or .xlsx inventory file.']);
      setIsPreviewOpen(true);
      return;
    }
    setFileBusy(true);
    try {
      const table = await readFileRows(file);
      const parsed = parseInventoryTable(table);
      const checked = validateInventoryImport(parsed.lines, products, warehouses, inventory);
      setParseErrors(parsed.errors);
      setValidation(checked);
      setIsPreviewOpen(true);
    } catch (error) {
      setParseErrors([
        `Could not read ${file.name}: ${(error as Error).message || 'unknown parsing error'}`,
      ]);
      setIsPreviewOpen(true);
    } finally {
      setFileBusy(false);
    }
  };

  const commitImport = () => {
    if (!validation?.valid) return;
    const res = excelImportStock(
      validation.rows.map(row => ({
        sku_code: row.line.skuCode,
        warehouse_code: row.line.warehouseCode,
        on_hand: row.line.onHand,
        unsellable: row.line.unsellable,
      })),
      validation.rows.map(row => ({
        sku_code: row.line.skuCode,
        warehouse_code: row.line.warehouseCode,
        previousOnHand: row.previousOnHand ?? -1,
        previousUnsellable: row.previousUnsellable ?? -1,
        reserved: row.reserved,
      }))
    );
    if (!res.success) {
      if (res.stale) {
        const refreshed = validateInventoryImport(
          validation.rows.map(row => row.line),
          products,
          warehouses,
          inventory
        );
        setValidation(refreshed);
        setImportError(
          res.error
            ? `库存自预览后已变化。已刷新差异，请重新检查并再次确认，不会自动覆盖。${res.error}`
            : '库存自预览后已变化。已刷新差异，请重新检查并再次确认，不会自动覆盖。'
        );
        setIsPreviewOpen(true);
      } else {
        setImportError(res.error ?? '导入被拒绝，库存未改变。');
      }
      return;
    }
    if (res.count !== validation.rows.length) {
      setImportError(
        `Import did not apply all rows (${res.count}/${validation.rows.length}). Inventory was not described as a real database transaction.`
      );
      return;
    }
    setImportFeedback(
      `已提交 ${res.count} 条 Mock 库存记录；reserved 预占未改变。刷新页面后可能丢失。`
    );
    resetImport();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-10">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            多仓现货库存与文件导入 (Inventory & Local Import)
          </h1>
          <p className="text-xs text-slate-500">
            支持本地 .xlsx / .csv；只更新前端 Mock 内存，不是真实数据库事务，也不连接云端。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 flex items-center gap-2"
            data-testid="download-inventory-template"
          >
            <Download className="w-4 h-4" />
            下载 CSV 模板
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileBusy}
            className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
            data-testid="choose-inventory-file"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            {fileBusy ? '正在解析…' : '选择库存文件'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={handleFile}
            className="sr-only"
            aria-label="Choose inventory file"
          />
          {validation && (
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
            >
              查看预览
            </button>
          )}
        </div>
      </div>

      {fileName && !isPreviewOpen && (
        <div className="p-3 rounded-xl bg-slate-100 text-xs text-slate-600 flex items-center justify-between gap-2">
          <span className="truncate">
            已选择：<strong>{fileName}</strong>
            {validation
              ? ` · ${validation.rows.filter(row => row.valid).length}/${validation.rows.length} 行可提交`
              : ' · 需要重新预览'}
          </span>
          <button type="button" onClick={resetImport} className="shrink-0 font-semibold text-slate-700">
            清除
          </button>
        </div>
      )}
      {importFeedback && (
        <div className="p-3 bg-emerald-900 text-emerald-100 text-xs rounded-xl flex items-center justify-between gap-2">
          <span>{importFeedback}</span>
          <button onClick={() => setImportFeedback('')} className="text-emerald-400">✕</button>
        </div>
      )}
      {importError && (
        <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center justify-between gap-2">
          <span>{importError}</span>
          <button onClick={() => setImportError('')} className="text-rose-500">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {warehouses.map(warehouse => {
          const balances = inventory.filter(balance => balance.warehouse_id === warehouse.id);
          const totalOnHand = balances.reduce((sum, balance) => sum + balance.on_hand, 0);
          const totalReserved = balances.reduce((sum, balance) => sum + balance.reserved, 0);
          const totalAvailable = balances.reduce(
            (sum, balance) =>
              sum + Math.max(0, balance.on_hand - balance.reserved - balance.unsellable),
            0
          );
          return (
            <div key={warehouse.id} className="bg-white p-4 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">{warehouse.name}</span>
                <span className="font-mono text-[10px] text-slate-400 px-1.5 py-0.5 bg-slate-100 rounded">
                  {warehouse.code}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 text-center">
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-[10px] text-slate-400">On hand</div>
                  <div className="font-mono font-bold text-xs">{totalOnHand}</div>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-[10px] text-slate-400">Reserved</div>
                  <div className="font-mono font-bold text-xs text-amber-600">{totalReserved}</div>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-[10px] text-slate-400">Available</div>
                  <div className="font-mono font-bold text-xs text-emerald-700">{totalAvailable}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-slate-700" />
            <span className="text-xs font-bold text-slate-900">SKU 多仓库存明细</span>
          </div>
          <span className="hidden sm:inline text-xs text-slate-400">Reserved 预占不会被导入覆盖</span>
        </div>
        <div className="sm:hidden p-3 space-y-2">
          {inventory.map((balance, index) => {
            const warehouse = warehouses.find(item => item.id === balance.warehouse_id);
            const skuCode = products.flatMap(product => product.skus).find(sku => sku.id === balance.sku_id)
              ?.sku_code ?? balance.sku_id;
            return (
              <div key={index} className="rounded-xl border border-slate-200 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono font-bold text-slate-900">{skuCode}</div>
                    <div className="text-[11px] text-slate-500">{warehouse?.name}</div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold text-emerald-700">
                      {Math.max(0, balance.on_hand - balance.reserved - balance.unsellable)} available
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {balance.on_hand} on hand · {balance.reserved} reserved
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/60 text-slate-400 text-[10px] uppercase font-semibold">
              <tr>
                <th className="p-3 pl-4">SKU</th>
                <th className="p-3">Warehouse</th>
                <th className="p-3 text-right">On hand</th>
                <th className="p-3 text-right">Reserved</th>
                <th className="p-3 text-right">Unsellable</th>
                <th className="p-3 text-right">Available</th>
                <th className="p-3 pr-4 text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inventory.map((balance, index) => {
                const warehouse = warehouses.find(item => item.id === balance.warehouse_id);
                const skuCode = products.flatMap(product => product.skus).find(sku => sku.id === balance.sku_id)
                  ?.sku_code ?? balance.sku_id;
                return (
                  <tr key={index}>
                    <td className="p-3 pl-4 font-mono font-bold">{skuCode}</td>
                    <td className="p-3 text-slate-600">{warehouse?.name}</td>
                    <td className="p-3 text-right font-mono">{balance.on_hand}</td>
                    <td className="p-3 text-right font-mono text-amber-600">{balance.reserved}</td>
                    <td className="p-3 text-right font-mono text-slate-500">{balance.unsellable}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-700">
                      {Math.max(0, balance.on_hand - balance.reserved - balance.unsellable)}
                    </td>
                    <td className="p-3 pr-4 text-right font-mono text-[11px] text-slate-400">
                      {balance.updated_at}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-6xl max-h-[100dvh] sm:max-h-[94dvh] overflow-y-auto bg-white sm:rounded-2xl border border-slate-200">
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h2 className="text-sm font-bold">库存导入预览 / Inventory import preview</h2>
                  <p className="text-[10px] text-slate-400">{fileName || '未选择文件'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                aria-label="Close import preview"
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 leading-relaxed">
                绝对库存快照只更新匹配的 SKU + 仓库；<strong>reserved 预占不变</strong>。
                若新 on-hand 减去 unsellable 小于 reserved，整批不可提交。文件解析与库存更新都是前端 Mock，不是真实事务。
              </div>
              {importError && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                  {importError}
                </div>
              )}

              {previewErrors.length > 0 && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                  <div className="font-bold">无法提交，发现 {previewErrors.length} 项问题：</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {previewErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validation && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50">总行数 <strong>{validation.rows.length}</strong></div>
                    <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800">可应用 <strong>{validation.rows.filter(row => row.valid).length}</strong></div>
                    <div className="p-3 rounded-xl bg-rose-50 text-rose-800">错误行 <strong>{validation.rows.filter(row => !row.valid).length}</strong></div>
                    <div className="p-3 rounded-xl bg-slate-50">Reserved <strong>不改变</strong></div>
                  </div>

                  <div className="sm:hidden space-y-2">
                    {validation.rows.map(row => (
                      <div key={row.line.rowNumber} className={`rounded-xl border p-3 text-xs space-y-1 ${row.valid ? 'border-slate-200' : 'border-rose-200 bg-rose-50'}`}>
                        <div className="flex justify-between gap-2">
                          <strong className="font-mono">{row.line.skuCode}</strong>
                          <span className="font-mono">{row.line.warehouseCode}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <span>On hand: {row.previousOnHand ?? '—'} → <strong>{row.line.onHand}</strong></span>
                          <span>Unsellable: {row.previousUnsellable ?? '—'} → <strong>{row.line.unsellable}</strong></span>
                          <span>Available: {row.previousAvailable ?? '—'} → <strong>{row.nextAvailable ?? '—'}</strong></span>
                          <span>Reserved: <strong>{row.reserved}</strong></span>
                        </div>
                        {row.errors.length > 0 && (
                          <div className="text-rose-700 font-semibold">{row.errors.join(' ')}</div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="hidden sm:block border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                        <tr>
                          <th className="p-2.5 pl-3">Row</th>
                          <th className="p-2.5">SKU</th>
                          <th className="p-2.5">Warehouse</th>
                          <th className="p-2.5 text-right">On hand</th>
                          <th className="p-2.5 text-right">Unsellable</th>
                          <th className="p-2.5 text-right">Available</th>
                          <th className="p-2.5 text-right">Reserved</th>
                          <th className="p-2.5 pr-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {validation.rows.map(row => (
                          <tr key={row.line.rowNumber} className={row.valid ? '' : 'bg-rose-50'}>
                            <td className="p-2.5 pl-3 font-mono text-slate-400">{row.line.rowNumber}</td>
                            <td className="p-2.5 font-mono font-bold">{row.line.skuCode}</td>
                            <td className="p-2.5 font-mono">{row.line.warehouseCode}</td>
                            <td className="p-2.5 text-right font-mono">{row.previousOnHand ?? '—'} → {row.line.onHand}</td>
                            <td className="p-2.5 text-right font-mono">{row.previousUnsellable ?? '—'} → {row.line.unsellable}</td>
                            <td className="p-2.5 text-right font-mono">{row.previousAvailable ?? '—'} → {row.nextAvailable ?? '—'}</td>
                            <td className="p-2.5 text-right font-mono text-amber-600">{row.reserved}</td>
                            <td className={`p-2.5 pr-3 text-right font-semibold ${row.valid ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {row.valid ? 'Valid' : row.errors.join(' ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-white py-2">
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={commitImport}
                  disabled={!canCommit}
                  data-testid="commit-inventory-import"
                  className="min-h-[44px] px-5 rounded-xl bg-slate-900 text-white text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-4 h-4 text-emerald-400" />
                  确认整批导入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
