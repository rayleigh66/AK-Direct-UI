import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { parseCsv, parseInventoryTable, type InventoryImportLine } from '../../utils/inventoryImport';
import { commitImport, previewImport } from '../api';
import type { CommitImportResultDto, ImportPreviewDto } from '../types';
import { ErrorBlock } from '../RealWorkspace';
import { Localized, useInternalLanguage } from '../internalLanguage';
import { formatEnglishDateTime } from '../../utils/dateDisplay';
import {
  INVENTORY_TEMPLATE_COLUMNS,
  INVENTORY_TEMPLATE_CSV,
  INVENTORY_TEMPLATE_EXAMPLE,
  downloadInventoryTemplate,
} from '../../utils/inventoryTemplate';

const MAX_FILE_BYTES = 1024 * 1024;

export const ImportView: React.FC = () => {
  const { t } = useInternalLanguage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [lines, setLines] = useState<InventoryImportLine[]>([]);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [result, setResult] = useState<CommitImportResultDto | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFileName('');
    setLines([]);
    setPreview(null);
    setResult(null);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setPreview(null);
    setResult(null);
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setError('File is larger than the 1 MB limit. / 文件超过 1 MB。');
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('Choose a .csv or .xlsx file. / 请选择 CSV 或 XLSX 文件。');
      return;
    }
    setBusy(true);
    try {
      let table: unknown[][];
      if (file.name.toLowerCase().endsWith('.csv')) {
        table = parseCsv(await file.text());
      } else {
        const module = await import('read-excel-file/browser');
        table = (await module.readSheet(file)) as unknown[][];
      }
      const parsed = parseInventoryTable(table);
      if (parsed.errors.length) {
        setError(parsed.errors.join(' '));
        return;
      }
      setLines(parsed.lines);
      const response = await previewImport({
        sourceName: file.name,
        idempotencyKey: crypto.randomUUID(),
        rows: parsed.lines.map(line => ({
          rowNumber: line.rowNumber,
          skuCode: line.skuCode,
          warehouseCode: line.warehouseCode,
          onHand: line.onHand,
          unsellable: line.unsellable,
        })),
      });
      setPreview(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import preview failed.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const committed = await commitImport(preview.batchId);
      setResult(committed);
      setPreview(current => (current ? { ...current, status: 'committed' } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import commit failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Localized>
    <div className="space-y-4">
      {error && <ErrorBlock message={error} />}

      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#fff1e8] text-[#ff681e] grid place-items-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold">Stock import / 库存导入</h2>
            <p className="text-[11px] text-slate-500">
              CSV or XLSX with sku_code, warehouse_code, on_hand, unsellable. Maximum 500 rows and
              1 MB. The server re-validates every row and commits all-or-nothing.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="h-10 px-4 rounded-xl bg-[#ff681e] text-white text-sm font-bold flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-4 h-4" />
            {busy && !preview ? 'Reading…' : 'Choose file / 选择文件'}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              data-testid="import-file"
              onChange={handleFile}
            />
          </label>
          {fileName && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              {fileName} · {t(`${lines.length} rows`, `${lines.length} 行`)}
              <button type="button" onClick={reset} aria-label="Clear file">
                <X className="w-4 h-4" />
              </button>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--subtle-bg)] p-3 text-[11px] text-[var(--muted)]">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="font-bold text-[var(--ink)]">Download CSV template / 下载 CSV 模板</div>
            <code
              title={INVENTORY_TEMPLATE_CSV.trim()}
              className="block whitespace-pre-wrap break-all font-mono text-[10px]"
              data-testid="import-template-preview"
            >
              {INVENTORY_TEMPLATE_CSV.trim()}
            </code>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" data-testid="import-template-guide">
              {INVENTORY_TEMPLATE_COLUMNS.map(column => (
                <div key={column.key} className="flex gap-2">
                  <dt className="shrink-0 font-mono font-bold text-[var(--ink)]">{column.key}</dt>
                  <dd>{t(column.en, column.zh)}</dd>
                </div>
              ))}
            </dl>
            <div
              data-testid="import-template-warning"
              className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900"
            >
              {t(
                `Replace the example SKU (${INVENTORY_TEMPLATE_EXAMPLE.sku_code}) and warehouse code (${INVENTORY_TEMPLATE_EXAMPLE.warehouse_code}) before uploading. The example row is never written automatically; the server validates every real SKU and warehouse.`,
                `上传前请替换示例 SKU（${INVENTORY_TEMPLATE_EXAMPLE.sku_code}）与仓库编码（${INVENTORY_TEMPLATE_EXAMPLE.warehouse_code}）。示例行不会自动写入；服务器会校验每个真实 SKU 与仓库。`
              )}
            </div>
            <div>
              {t(
                'Header plus one example row, ready for Excel. Downloading never writes inventory.',
                '表头加一行示例，可直接用 Excel 打开。下载不会写入库存。'
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={downloadInventoryTemplate}
            data-testid="import-template-download"
            className="fo-btn flex items-center gap-1.5"
            aria-label="Download CSV template"
          >
            <Download className="h-4 w-4" /> Download CSV template
          </button>
        </div>
      </section>

      {preview && !result && (
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">Server preview / 服务端预览</h3>
              <p className="text-[11px] text-slate-500">
                Values below come from PostgreSQL. Confirming locks each row and rejects the whole
                batch if anything changed.
              </p>
            </div>
            <button
              type="button"
              onClick={commit}
              disabled={busy || preview.status !== 'previewed'}
              data-testid="import-commit"
              className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50"
            >
              {busy ? 'Committing…' : 'Confirm import / 确认导入'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[680px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Row</th>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Warehouse</th>
                  <th className="text-right px-3 py-2">On hand (old → new)</th>
                  <th className="text-right px-3 py-2">Unsellable (old → new)</th>
                  <th className="text-right px-3 py-2">Reserved</th>
                  <th className="text-right px-3 py-2">Version</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map(row => (
                  <tr key={row.rowNumber} className="border-t border-slate-100" data-testid="import-row">
                    <td className="px-3 py-2">{row.rowNumber}</td>
                    <td className="px-3 py-2 font-mono">{row.skuCode}</td>
                    <td className="px-3 py-2">{row.warehouseCode}</td>
                    <td className="px-3 py-2 text-right">
                      {row.onHandBefore} → <strong>{row.onHandNew}</strong>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.unsellableBefore} → <strong>{row.unsellableNew}</strong>
                    </td>
                    <td className="px-3 py-2 text-right">{row.reserved}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{row.versionBefore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs text-emerald-900 space-y-2">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="w-4 h-4" />
            {result.alreadyCommitted ? 'Already imported (idempotent)' : 'Import committed'}
          </div>
          <p>
            {t(
              `${result.rows.length} rows applied at ${formatEnglishDateTime(result.committedAt)}. Repeated confirmation with the same preview does not change stock again.`,
              `${result.rows.length} 行已应用，时间 ${formatEnglishDateTime(result.committedAt)}。使用同一预览重复确认不会再次变更库存。`
            )}
          </p>
          <button
            type="button"
            onClick={reset}
            className="h-9 px-3 rounded-xl border border-emerald-300 bg-white font-semibold"
          >
            Import another file
          </button>
        </section>
      )}
    </div>
    </Localized>
  );
};
