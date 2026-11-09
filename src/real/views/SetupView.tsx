import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  createSeries,
  createTag,
  createWarehouse,
  listSeries,
  listTags,
  listWarehouses,
  updateSeries,
  updateTag,
  updateWarehouse,
} from '../api';
import type { SeriesDto, TagDto, WarehouseDto } from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';
import { WarehouseNameEditor } from '../components/WarehouseNameEditor';

const inputClass =
  'w-full h-9 px-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff681e]';

export const SetupView: React.FC = () => {
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [series, setSeries] = useState<SeriesDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    const [warehouseItems, seriesItems, tagItems] = await Promise.all([
      listWarehouses(),
      listSeries(),
      listTags(),
    ]);
    setWarehouses(warehouseItems);
    setSeries(seriesItems);
    setTags(tagItems);
  };

  const load = () => {
    setLoading(true);
    setError('');
    refresh()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request failed.');
      return false;
    }
  };

  if (loading) return <LoadingBlock label="Loading setup…" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBlock message={error} onRetry={load} />}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-bold">Warehouses / 仓库</h2>
        <p className="text-[11px] text-slate-500">
          No warehouse or stock is seeded. Create the real warehouse code before registering stock.
        </p>
        <div className="space-y-2">
          {warehouses.map(warehouse => (
            <div
              key={warehouse.id}
              className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-slate-200 text-xs"
              data-testid="warehouse-row"
            >
              <span className="font-mono font-bold">{warehouse.code}</span>
              <WarehouseNameEditor warehouse={warehouse} onSave={names => run(
                () => updateWarehouse(warehouse.id, names), 'Warehouse bilingual names updated.'
              )} />
              <span
                className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  warehouse.active
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {warehouse.active ? 'active' : 'inactive'}
              </span>
              <button
                type="button"
                onClick={() =>
                  run(
                    () => updateWarehouse(warehouse.id, { active: !warehouse.active }),
                    'Warehouse updated.'
                  )
                }
                className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] font-semibold"
              >
                {warehouse.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
          {!warehouses.length && <div className="text-xs text-slate-500">No warehouses yet.</div>}
        </div>
        <SimpleCreate
          fields={[
            { key: 'code', label: 'Code (e.g. WH-SH)', testId: 'warehouse-code' },
            { key: 'name', label: '中文名称', testId: 'warehouse-name-zh' },
            { key: 'nameEn', label: 'English name', testId: 'warehouse-name-en' },
          ]}
          submitLabel="Create warehouse"
          testId="warehouse-create-submit"
          onSubmit={async values => {
            await run(() => createWarehouse(values), 'Warehouse created.');
          }}
        />
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-bold">Series / 系列</h2>
        <div className="space-y-2">
          {series.map(item => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-slate-200 text-xs"
            >
              <span className="font-semibold">{item.nameEn}</span>
              <span className="text-slate-500">{item.nameZh}</span>
              <span className="text-[10px] text-slate-400">{item.productCount} products</span>
              <span
                className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  item.active
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {item.active ? 'active' : 'inactive'}
              </span>
              <button
                type="button"
                onClick={() =>
                  run(() => updateSeries(item.id, { active: !item.active }), 'Series updated.')
                }
                className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] font-semibold"
              >
                {item.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
          {!series.length && <div className="text-xs text-slate-500">No series yet.</div>}
        </div>
        <SimpleCreate
          fields={[
            { key: 'nameZh', label: '中文名称', testId: 'series-name-zh' },
            { key: 'nameEn', label: 'English name', testId: 'series-name-en' },
          ]}
          submitLabel="Create series"
          testId="series-create-submit"
          onSubmit={async values => {
            await run(() => createSeries(values), 'Series created.');
          }}
        />
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-bold">Feature tags / 功能标签</h2>
        <p className="text-[11px] text-slate-500">
          Tags and series cannot be deleted; deactivate them instead. Existing product links remain.
        </p>
        <div className="space-y-2">
          {tags.map(tag => (
            <div
              key={tag.id}
              className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-slate-200 text-xs"
            >
              <span className="font-mono font-bold">{tag.id}</span>
              <span className="font-semibold">{tag.nameEn}</span>
              <span className="text-slate-500">{tag.nameZh}</span>
              <span className="text-[10px] text-slate-400">{tag.productCount} products</span>
              <span
                className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  tag.active
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
              >
                {tag.active ? 'active' : 'inactive'}
              </span>
              <button
                type="button"
                onClick={() => run(() => updateTag(tag.id, { active: !tag.active }), 'Tag updated.')}
                className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] font-semibold"
              >
                {tag.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
          {!tags.length && <div className="text-xs text-slate-500">No tags yet.</div>}
        </div>
        <SimpleCreate
          fields={[
            { key: 'code', label: 'Code (e.g. WATERPROOF)', testId: 'tag-code' },
            { key: 'nameZh', label: '中文名称', testId: 'tag-name-zh' },
            { key: 'nameEn', label: 'English name', testId: 'tag-name-en' },
          ]}
          submitLabel="Create tag"
          testId="tag-create-submit"
          onSubmit={async values => {
            await run(() => createTag(values), 'Tag created.');
          }}
        />
      </section>
    </div>
  );
};

const SimpleCreate: React.FC<{
  fields: Array<{ key: string; label: string; testId?: string }>;
  submitLabel: string;
  testId?: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}> = ({ fields, submitLabel, testId, onSubmit }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100"
      onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSubmit(values);
          setValues({});
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map(field => (
        <label key={field.key} className="text-[11px] font-semibold text-slate-600 flex-1 min-w-[130px]">
          {field.label}
          <input
            value={values[field.key] ?? ''}
            onChange={event => setValues({ ...values, [field.key]: event.target.value })}
            className={`${inputClass} mt-1`}
            data-testid={field.testId}
            required
          />
        </label>
      ))}
      <button
        type="submit"
        disabled={busy}
        data-testid={testId}
        className="h-9 px-3 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" /> {submitLabel}
      </button>
    </form>
  );
};
