import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, Plus, RefreshCw, Search } from 'lucide-react';
import {
  adjustInventory,
  listAdminInventory,
  listAdminProducts,
  listInventory,
  listWarehouses,
  registerInventory,
  updateWarehouse,
} from '../api';
import type { InventoryRowDto, ProductDto, WarehouseDto } from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';
import { WarehouseInventoryView } from './WarehouseInventoryView';
import { Localized } from '../internalLanguage';

const inputClass =
  'w-full h-10 px-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff681e]';

export const InventoryView: React.FC<{
  canManage: boolean;
  canRead: boolean;
  internal: boolean;
}> = ({ canManage, canRead, internal }) => {
  const [rows, setRows] = useState<InventoryRowDto[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [view, setView] = useState<'list' | 'warehouse'>('list');

  const load = () => {
    setLoading(true);
    setError('');
    const list = canManage ? listAdminInventory() : listInventory();
    Promise.all([
      list,
      canManage ? listWarehouses() : Promise.resolve([]),
      canManage ? listAdminProducts() : Promise.resolve([]),
    ])
      .then(([inventory, warehouseItems, productItems]) => {
        setRows(inventory);
        setWarehouses(warehouseItems);
        setProducts(productItems);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const refresh = async () => {
    const list = canManage ? listAdminInventory() : listInventory();
    setRows(await list);
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(success);
      setAdjusting(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request failed.');
      return false;
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const warehouseRows = warehouseFilter ? rows.filter(row => row.warehouseId === warehouseFilter) : rows;
    if (!needle) return warehouseRows;
    return warehouseRows.filter(row =>
      `${row.skuCode} ${row.productCode} ${row.productTitle} ${row.warehouseCode}`
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, search, warehouseFilter]);

  if (!canRead) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-sm text-slate-500 text-center">
        You do not have inventory access. / 无库存查看权限。
      </div>
    );
  }
  if (loading) return <LoadingBlock label="Loading inventory… / 正在加载库存…" />;

  return (
    <Localized>
    <div className="space-y-4">
      {error && <ErrorBlock message={error} onRetry={load} />}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      {canManage && <div className="flex flex-wrap items-center gap-2" aria-label="库存视图">
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${view === 'list' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300'}`}>库存列表</button>
        <button type="button" aria-pressed={view === 'warehouse'} onClick={() => { setView('warehouse'); setRegisterOpen(false); }} className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${view === 'warehouse' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300'}`}>仓库视图</button>
      </div>}
      {view === 'warehouse' && canManage ? <WarehouseInventoryView rows={rows} warehouses={warehouses} products={products}
        onRegistered={async row => {
          setRows(current => [...current.filter(item => item.skuId !== row.skuId || item.warehouseId !== row.warehouseId), row]);
          await refresh();
          setNotice('库存已登记，流水与审计由服务器记录。');
        }}
        onAdjust={row => {
          setRows(current => [...current.filter(item => item.skuId !== row.skuId || item.warehouseId !== row.warehouseId), row]);
          setSearch(''); setWarehouseFilter(null); setAdjusting(`${row.skuId}:${row.warehouseId}`); setView('list');
        }}
        onViewWarehouse={warehouse => { setSearch(''); setWarehouseFilter(warehouse.id); setAdjusting(null); setView('list'); }}
        onRename={async (warehouse, names) => {
          const saved = await updateWarehouse(warehouse.id, names);
          setWarehouses(current => current.map(item => item.id === saved.id ? saved : item));
          return true;
        }} /> : <>
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 text-sm flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search SKU, product or warehouse"
              className="flex-1 outline-none bg-transparent"
              data-testid="inventory-search"
            />
          </label>
          <button
            type="button"
            onClick={() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Refresh failed.')); }}
            className="h-10 px-3 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setRegisterOpen(value => !value)}
              data-testid="inventory-register-open"
              className="h-10 px-4 rounded-xl bg-[#ff681e] text-white text-sm font-bold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Register stock / 登记库存
            </button>
          )}
        </div>
        {warehouseFilter && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>仓库 · {warehouses.find(item => item.id === warehouseFilter)?.code}</span>
          <button type="button" onClick={() => setWarehouseFilter(null)} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">清除仓库筛选</button>
        </div>}
        <p className="text-[11px] text-slate-500">
          {canManage
            ? 'Administrator view: on hand, reserved and unsellable per SKU and warehouse.'
            : 'Read-only stock view. Sales cannot adjust quantities or reserved stock.'}
        </p>
        {registerOpen && canManage && (
          <RegisterForm
            products={products}
            warehouses={warehouses}
            onSubmit={async input => {
              if (await run(() => registerInventory(input), 'Inventory registered.')) setRegisterOpen(false);
            }}
          />
        )}
      </section>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left font-semibold px-3 py-2">SKU</th>
                <th className="text-left font-semibold px-3 py-2">Product</th>
                <th className="text-left font-semibold px-3 py-2">Warehouse</th>
                <th className="text-right font-semibold px-3 py-2">On hand</th>
                <th className="text-right font-semibold px-3 py-2">Reserved</th>
                <th className="text-right font-semibold px-3 py-2">Unsellable</th>
                <th className="text-right font-semibold px-3 py-2">Available</th>
                <th className="text-right font-semibold px-3 py-2">Version</th>
                {canManage && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={`${row.skuId}:${row.warehouseId}`} className="border-t border-slate-100" data-testid="inventory-row">
                  <td className="px-3 py-2 font-mono">{row.skuCode}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{row.productCode}</div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[220px]">
                      {row.productTitle}
                    </div>
                  </td>
                  <td className="px-3 py-2">{row.warehouseCode}</td>
                  <td className="px-3 py-2 text-right">{row.onHand}</td>
                  <td className="px-3 py-2 text-right">{row.reserved}</td>
                  <td className="px-3 py-2 text-right">{row.unsellable}</td>
                  <td className="px-3 py-2 text-right font-bold">{row.available}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{row.version}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setAdjusting(
                            adjusting === `${row.skuId}:${row.warehouseId}`
                              ? null
                              : `${row.skuId}:${row.warehouseId}`
                          )
                        }
                        className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] font-semibold"
                      >
                        Adjust
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="px-3 py-8 text-center text-slate-500">
                    <Boxes className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                    No inventory rows. Register stock explicitly for a SKU and warehouse.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canManage &&
          visible
            .filter(row => adjusting === `${row.skuId}:${row.warehouseId}`)
            .map(row => (
              <AdjustForm
                key={`${row.skuId}:${row.warehouseId}-form`}
                row={row}
                onSubmit={async input => {
                  await run(
                    () => adjustInventory(row.skuId, row.warehouseId, input),
                    'Inventory adjusted and audited.'
                  );
                }}
              />
            ))}
      </div>
      </>}
      {!internal && null}
    </div>
    </Localized>
  );
};

const RegisterForm: React.FC<{
  products: ProductDto[];
  warehouses: WarehouseDto[];
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}> = ({ products, warehouses, onSubmit }) => {
  const skus = products.flatMap(product =>
    product.skus.map(sku => ({ ...sku, productCode: product.productCode }))
  );
  const [skuId, setSkuId] = useState(skus[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(
    warehouses.find(item => item.active)?.id ?? ''
  );
  const [onHand, setOnHand] = useState('');
  const [unsellable, setUnsellable] = useState('0');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!skus.length || !warehouses.length) {
    return (
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
        Create a product with an SKU and an active warehouse before registering stock.
      </div>
    );
  }

  return (
    <Localized>
    <form
      className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200"
      onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSubmit({
            skuId,
            warehouseId,
            onHand: Number(onHand),
            unsellable: Number(unsellable),
            reason,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-xs font-semibold text-slate-700 lg:col-span-2">
        SKU
        <select
          value={skuId}
          onChange={event => setSkuId(event.target.value)}
          className={`${inputClass} mt-1`}
          data-testid="inventory-register-sku"
        >
          {skus.map(sku => (
            <option key={sku.id} value={sku.id}>
              {sku.productCode} · {sku.skuCode} · {sku.colorNameEn}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Warehouse
        <select
          value={warehouseId}
          onChange={event => setWarehouseId(event.target.value)}
          className={`${inputClass} mt-1`}
          data-testid="inventory-register-warehouse"
        >
          {warehouses
            .filter(item => item.active)
            .map(item => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.nameEn}
              </option>
            ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-700">
        On hand
        <input
          type="number"
          min="0"
          value={onHand}
          onChange={event => setOnHand(event.target.value)}
          className={`${inputClass} mt-1`}
          required
          max={100_000_000}
          step={1}
          data-testid="inventory-register-onhand"
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Unsellable
        <input
          type="number"
          min="0"
          value={unsellable}
          onChange={event => setUnsellable(event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700 lg:col-span-3">
        Reason
        <input
          value={reason}
          required
          maxLength={500}
          data-testid="inventory-register-reason"
          onChange={event => setReason(event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        data-testid="inventory-register-submit"
        className="h-10 rounded-xl bg-slate-900 text-white text-sm font-bold self-end disabled:opacity-50"
      >
        Register
      </button>
    </form>
    </Localized>
  );
};

const AdjustForm: React.FC<{
  row: InventoryRowDto;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}> = ({ row, onSubmit }) => {
  const [onHand, setOnHand] = useState(String(row.onHand));
  const [unsellable, setUnsellable] = useState(String(row.unsellable));
  const [reason, setReason] = useState('Stock count adjustment');
  const [busy, setBusy] = useState(false);

  return (
    <Localized>
    <form
      className="border-t border-slate-200 bg-slate-50 p-3 flex flex-wrap items-end gap-2 text-xs"
      onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSubmit({
            onHand: Number(onHand),
            unsellable: Number(unsellable),
            expectedVersion: row.version,
            reason,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="font-mono text-[11px] text-slate-500 w-full">
        {row.skuCode} @ {row.warehouseCode} · version {row.version}
      </div>
      <label className="font-semibold text-slate-700">
        On hand
        <input
          type="number"
          min="0"
          value={onHand}
          onChange={event => setOnHand(event.target.value)}
          className={`${inputClass} mt-1 w-28`}
          data-testid="inventory-adjust-onhand"
        />
      </label>
      <label className="font-semibold text-slate-700">
        Unsellable
        <input
          type="number"
          min="0"
          value={unsellable}
          onChange={event => setUnsellable(event.target.value)}
          className={`${inputClass} mt-1 w-28`}
        />
      </label>
      <label className="font-semibold text-slate-700 flex-1 min-w-[180px]">
        Reason
        <input
          value={reason}
          onChange={event => setReason(event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        data-testid="inventory-adjust-submit"
        className="h-10 px-4 rounded-xl bg-[#ff681e] text-white font-bold disabled:opacity-50"
      >
        Save adjustment
      </button>
    </form>
    </Localized>
  );
};
