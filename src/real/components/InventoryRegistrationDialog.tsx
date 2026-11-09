import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AuthApiError } from '../../auth/api';
import { SelectAllOnFocusInput } from '../../components/ui/SelectAllOnFocusInput';
import { listAdminInventory, registerInventory } from '../api';
import type { InventoryRowDto, WarehouseDto } from '../types';

export const InventoryRegistrationDialog: React.FC<{
  sku: { id: string; skuCode: string; label: string };
  warehouse: WarehouseDto;
  onClose: () => void;
  onExisting: (row: InventoryRowDto) => void;
  onRegistered: (row: InventoryRowDto) => Promise<void>;
}> = ({ sku, warehouse, onClose, onExisting, onRegistered }) => {
  const [onHand, setOnHand] = useState('');
  const [unsellable, setUnsellable] = useState('0');
  const [reason, setReason] = useState('');
  const [existing, setExisting] = useState<InventoryRowDto | null>(null);
  const [checking, setChecking] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const titleId = useId();
  const lookup = async () => {
    setChecking(true); setError(''); setVerified(false);
    try {
      const rows = await listAdminInventory({ skuId: sku.id, warehouseId: warehouse.id });
      if (!alive.current) return;
      setExisting(rows[0] ?? null); setVerified(true); setUncertain(false);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : '查询失败，请重试。');
    } finally { if (alive.current) setChecking(false); }
  };
  useEffect(() => {
    alive.current = true;
    void lookup();
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    return () => { alive.current = false; document.body.style.overflow = overflow; previous?.focus(); };
    // This component is keyed by the fixed SKU/warehouse pair; cancellation unmounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = async () => {
    if (pending.current || checking || !verified || existing || uncertain || committed) return;
    const count = Number(onHand), damaged = Number(unsellable);
    if (!onHand.trim() || !unsellable.trim() || !Number.isInteger(count) || count < 0 || count > 100_000_000 ||
      !Number.isInteger(damaged) || damaged < 0 || damaged > count || !reason.trim() || reason.trim().length > 500) {
      setError('请填写 0–100000000 的整数数量、有效不可售数量及登记原因。'); return;
    }
    pending.current = true; setBusy(true); setError('');
    let saved: InventoryRowDto;
    try {
      saved = await registerInventory({ skuId: sku.id, warehouseId: warehouse.id, onHand: count, unsellable: damaged, reason: reason.trim() });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof AuthApiError && err.status === 409 && err.code === 'inventory_exists') {
        // Another administrator won the unique tuple. Read it; never convert this POST to PATCH.
        await lookup();
      } else if (err instanceof AuthApiError && err.status < 500) {
        setError(err.message);
      } else {
        setUncertain(true); setVerified(false);
        setError('提交结果尚未确认。请查询最新状态后再决定是否重新登记。');
      }
      pending.current = false; setBusy(false); return;
    }
    // A successful POST must not become retryable if the follow-up GET fails.
    if (!alive.current) return;
    setCommitted(true);
    try { await onRegistered(saved); if (alive.current) close.current(); }
    catch { if (alive.current) setError('已登记成功，列表刷新失败。请关闭后刷新查看，请勿重复登记。'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const fieldClass = 'mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm focus:ring-2 focus:ring-[#ff681e] focus:outline-none';
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6">
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-6 shadow-xl outline-none"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!pending.current) close.current(); }
        if (event.key === 'Tab') {
          const elements = Array.from(root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'));
          const first = elements[0], last = elements[elements.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-bold">确认库存登记</h2>
        <button type="button" aria-label="关闭登记窗口" disabled={busy} onClick={onClose} className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 flex items-center justify-center disabled:opacity-40"><X className="h-5 w-5" /></button>
      </div>
      <p className="mt-3 font-mono text-sm font-semibold break-words">{sku.skuCode} → {warehouse.code}</p>
      <p className="mt-1 text-sm text-slate-500">{warehouse.name} · {warehouse.nameEn}</p>
      <p className="mt-3 text-xs leading-relaxed text-slate-600">登记该仓库实际盘点后的绝对库存数量。此操作不代表仓间调拨，也不会扣减其他仓库。</p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {checking ? <p role="status" className="mt-4 text-sm text-slate-500">正在核对已有库存记录…</p> : existing ? <div className="mt-4 space-y-3">
        <p className="text-sm font-semibold">此 SKU 已在该仓库登记，请查看或独立调整已有库存。</p>
        <p className="text-sm text-slate-600">在手 {existing.onHand} · 预占 {existing.reserved} · 不可售 {existing.unsellable} PCS · 版本 {existing.version}</p>
        <button type="button" className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white" onClick={() => onExisting(existing)}>查看／调整已有库存</button>
      </div> : committed ? <p role="status" className="mt-4 text-sm font-semibold text-emerald-700">库存登记已保存。</p> : <form noValidate data-testid="warehouse-registration-form" className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="block text-sm font-semibold">登记后在手数量
          <SelectAllOnFocusInput type="number" inputMode="numeric" min={0} max={100_000_000} step={1} value={onHand} disabled={busy || !verified}
            onChange={event => setOnHand(event.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm font-semibold">其中不可售数量
          <SelectAllOnFocusInput type="number" inputMode="numeric" min={0} max={100_000_000} step={1} value={unsellable} disabled={busy || !verified}
            onChange={event => setUnsellable(event.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm font-semibold">登记原因
          <textarea value={reason} maxLength={500} disabled={busy || !verified} onChange={event => setReason(event.target.value)} className={`${fieldClass} min-h-20 py-2`} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">取消</button>
          <button type="submit" disabled={busy || !verified || uncertain} className="min-h-11 flex-1 rounded-xl bg-[#ff681e] px-4 text-sm font-bold text-white disabled:opacity-40">{busy ? '正在登记…' : '确认登记'}</button>
        </div>
      </form>}
      {!checking && !committed && !verified && <button type="button" disabled={busy} className="mt-3 min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold" onClick={() => void lookup()}>查询最新状态</button>}
    </div>
  </div>;
};
