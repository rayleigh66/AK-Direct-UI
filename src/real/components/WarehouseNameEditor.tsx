import React, { useState } from 'react';
import type { WarehouseDto } from '../types';

/** The existing name-only API is shared by Setup and the warehouse inventory view. */
export const WarehouseNameEditor: React.FC<{
  warehouse: WarehouseDto;
  onSave: (names: { name: string; nameEn: string }) => Promise<boolean>;
}> = ({ warehouse, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState({ name: '', nameEn: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!editing) return <>
    <span className="font-semibold">{warehouse.nameEn}</span>
    <span className="text-slate-500">{warehouse.name}</span>
    <button type="button" data-testid="warehouse-edit" className="min-h-11 px-3 rounded-lg border border-slate-300 text-xs font-semibold"
      onClick={() => { setNames({ name: warehouse.name, nameEn: warehouse.nameEn }); setEditing(true); setError(''); }}>
      Edit names
    </button>
  </>;
  return <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
    <label className="min-w-[120px] flex-1 text-xs font-semibold text-slate-600">中文名称
      <input value={names.name} maxLength={200} disabled={busy} data-testid="warehouse-edit-name-zh"
        onChange={event => setNames(prev => ({ ...prev, name: event.target.value }))}
        className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-2 text-sm" />
    </label>
    <label className="min-w-[120px] flex-1 text-xs font-semibold text-slate-600">English name
      <input value={names.nameEn} maxLength={200} disabled={busy} data-testid="warehouse-edit-name-en"
        onChange={event => setNames(prev => ({ ...prev, nameEn: event.target.value }))}
        className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-2 text-sm" />
    </label>
    <button type="button" data-testid="warehouse-edit-save" disabled={busy}
      className="h-11 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-50"
      onClick={async () => {
        if (busy) return;
        if (!names.name.trim() || !names.nameEn.trim()) { setError('Both the Chinese and English warehouse names are required.'); return; }
        setBusy(true); setError('');
        try { if (await onSave({ name: names.name.trim(), nameEn: names.nameEn.trim() })) setEditing(false); }
        catch (err) { setError(err instanceof Error ? err.message : 'Unable to save warehouse names.'); }
        finally { setBusy(false); }
      }}>Save</button>
    <button type="button" data-testid="warehouse-edit-cancel" disabled={busy} onClick={() => setEditing(false)}
      className="h-11 rounded-lg border border-slate-300 px-3 text-xs font-semibold">Cancel</button>
    {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
  </div>;
};
