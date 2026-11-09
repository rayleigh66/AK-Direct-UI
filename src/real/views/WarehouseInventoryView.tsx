import React, { useMemo, useState } from 'react';
import { Boxes, GripVertical, Warehouse } from 'lucide-react';
import { SearchableCombobox } from '../../components/ui/SearchableCombobox';
import { InventoryRegistrationDialog } from '../components/InventoryRegistrationDialog';
import { WarehouseNameEditor } from '../components/WarehouseNameEditor';
import type { InventoryRowDto, ProductDto, WarehouseDto } from '../types';
import { Localized, useInternalLanguage } from '../internalLanguage';

const skuMime = 'application/x-aoking-sku';
export const WarehouseInventoryView: React.FC<{
  rows: InventoryRowDto[]; products: ProductDto[]; warehouses: WarehouseDto[];
  onRegistered: (row: InventoryRowDto) => Promise<void>;
  onAdjust: (row: InventoryRowDto) => void;
  onViewWarehouse: (warehouse: WarehouseDto) => void;
  onRename: (warehouse: WarehouseDto, names: { name: string; nameEn: string }) => Promise<boolean>;
}> = ({ rows, products, warehouses, onRegistered, onAdjust, onViewWarehouse, onRename }) => {
  const { t } = useInternalLanguage();
  const [skuId, setSkuId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [hovered, setHovered] = useState('');
  const [draft, setDraft] = useState<{ skuId: string; warehouseId: string } | null>(null);
  const skus = useMemo(() => products.flatMap(product => product.skus.map(sku => ({
    ...sku, label: `${sku.skuCode} · ${product.title} · ${sku.colorName}`,
    keywords: `${product.productCode} ${product.titleEn} ${sku.colorNameEn}`,
  }))), [products]);
  const selected = skus.find(sku => sku.id === skuId);
  const draftSku = skus.find(sku => sku.id === draft?.skuId);
  const draftWarehouse = warehouses.find(warehouse => warehouse.id === draft?.warehouseId);
  const open = (id: string, targetId: string) => {
    if (skus.some(sku => sku.id === id) && warehouses.some(warehouse => warehouse.id === targetId && warehouse.active)) {
      setDraft({ skuId: id, warehouseId: targetId });
    }
  };
  return <Localized><div data-testid="warehouse-view" className="grid min-w-0 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
      <div><p className="text-xs font-semibold tracking-wider text-slate-500">SKU DIRECTORY</p><h2 className="mt-1 text-lg font-bold">选择需要登记的 SKU</h2></div>
      <SearchableCombobox ariaLabel="搜索并选择 SKU" placeholder="搜索 SKU、商品或颜色" value={skuId} onChange={setSkuId}
        options={skus.map(sku => ({ value: sku.id, label: sku.label, keywords: sku.keywords }))} emptyText="没有匹配的 SKU" />
      {selected ? <div draggable data-testid="warehouse-sku-drag" onDragStart={event => {
        event.dataTransfer.setData(skuMime, selected.id); event.dataTransfer.effectAllowed = 'copy';
      }} onDragEnd={() => setHovered('')} className="rounded-xl border border-slate-200 bg-slate-50 p-3 cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2"><span style={{ backgroundColor: selected.colorHex }} className="h-4 w-4 shrink-0 rounded-full border border-slate-300" /><span className="min-w-0 flex-1 break-all font-mono text-sm font-bold">{selected.skuCode}</span><GripVertical className="h-4 w-4 shrink-0 text-slate-400" /></div>
        <p className="mt-2 text-sm text-slate-600">{selected.colorName} · {selected.colorNameEn}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">拖至右侧启用仓库，或在下方选择仓库。放下后仍需确认数量及原因。</p>
      </div> : <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500"><Boxes className="mx-auto mb-2 h-6 w-6 text-slate-400" />搜索商品目录中的 SKU，包括尚无库存记录的 SKU。</div>}
      <div className="space-y-2 border-t border-slate-100 pt-4">
        <label className="block text-xs font-semibold text-slate-600">登记至</label>
        <SearchableCombobox ariaLabel="选择登记仓库" placeholder="选择启用仓库" value={warehouseId} onChange={setWarehouseId}
          options={warehouses.filter(warehouse => warehouse.active).map(warehouse => ({ value: warehouse.id, label: `${warehouse.code} · ${warehouse.name} · ${warehouse.nameEn}` }))} emptyText="没有启用仓库" />
        <button type="button" disabled={!selected || !warehouseId} onClick={() => open(skuId, warehouseId)} className="min-h-11 w-full rounded-xl bg-[#ff681e] px-4 text-sm font-bold text-white disabled:opacity-40">准备登记</button>
        <p className="text-xs leading-relaxed text-slate-500">手机与键盘均可通过选择操作，无需拖拽。</p>
      </div>
    </section>
    <section className="min-w-0 space-y-3">
      <div className="flex items-center gap-2 px-1"><Warehouse className="h-5 w-5 text-slate-500" /><h2 className="text-lg font-bold">仓库与库存记录</h2><span className="ml-auto text-xs text-slate-500">{t(`${warehouses.length} warehouses`, `${warehouses.length} 个仓库`)}</span></div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {warehouses.map(warehouse => {
          const balances = rows.filter(row => row.warehouseId === warehouse.id);
          return <article key={warehouse.id} data-testid={`warehouse-card-${warehouse.id}`}
            onDragOver={event => { if (warehouse.active && event.dataTransfer.types.includes(skuMime)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setHovered(warehouse.id); } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(''); }}
            onDrop={event => { event.preventDefault(); setHovered(''); open(event.dataTransfer.getData(skuMime), warehouse.id); }}
            className={`min-w-0 rounded-2xl border bg-white p-4 sm:p-5 ${hovered === warehouse.id ? 'border-[#ff681e] ring-2 ring-[#ff681e]/20' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-sm font-bold">{warehouse.code}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${warehouse.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{warehouse.active ? '启用' : '已停用'}</span></div>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm"><WarehouseNameEditor warehouse={warehouse} onSave={names => onRename(warehouse, names)} /></div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-3 text-xs text-slate-500">{t(`${balances.length} SKU inventory records · PCS`, `${balances.length} 条 SKU 库存记录 · PCS`)}</p>
              {balances.slice(0, 4).map(row => <div key={row.skuId} className="border-t border-slate-100 py-3 first:border-0 first:pt-0">
                <p className="break-all font-mono text-xs font-semibold">{row.skuCode}</p>
                <dl className="mt-2 grid grid-cols-4 gap-2 text-right tabular-nums">
                  {([['在手', row.onHand], ['预占', row.reserved], ['不可售', row.unsellable], ['可用', row.available]] as const).map(([label, value]) => <div key={label}><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold">{value.toLocaleString()}</dd></div>)}
                </dl>
                <button type="button" onClick={() => onAdjust(row)} className="mt-2 min-h-11 text-xs font-semibold text-slate-700 underline underline-offset-4">{t(`View / adjust · v${row.version}`, `查看／独立调整 · v${row.version}`)}</button>
              </div>)}
              {!balances.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">尚无库存记录。</p>}
              <button type="button" onClick={() => onViewWarehouse(warehouse)} className="mt-3 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-xs font-semibold">查看该仓库全部记录</button>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">{warehouse.active ? '可接收 SKU 登记；已有记录将进入查看或独立调整。' : '停用仓库不接受首次登记。已有库存记录仍可查看。'}</p>
            </div>
          </article>;
        })}
      </div>
      {!warehouses.length && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">尚无仓库。请先在基础设置中创建真实仓库。</p>}
    </section>
    {draft && draftSku && draftWarehouse && <InventoryRegistrationDialog key={`${draft.skuId}:${draft.warehouseId}`} sku={draftSku} warehouse={draftWarehouse}
      onClose={() => setDraft(null)} onRegistered={onRegistered} onExisting={row => { setDraft(null); onAdjust(row); }} />}
  </div></Localized>;
};
