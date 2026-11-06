import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Plus, Search, Star, Trash2 } from 'lucide-react';
import {
  createProduct,
  createSku,
  getPendingOrderImpact,
  listAdminBrands,
  listAdminProducts,
  listSeries,
  listTags,
  removeImage,
  reorderImages,
  setPrimaryImage,
  setPublished,
  updateProduct,
  updateSku,
  uploadProductImage,
} from '../api';
import type {
  BrandDto,
  OrderImpactDto,
  OrderImpactKind,
  ProductDto,
  SeriesDto,
  SkuDto,
  TagDto,
} from '../types';
import { usdFromCents } from '../cart';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';

const inputClass =
  'w-full h-10 px-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff681e]';
const usd = (cents: number) => (cents / 100).toFixed(2);

export const AdminCatalogView: React.FC<{ canWrite: boolean }> = ({ canWrite }) => {
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [brands, setBrands] = useState<BrandDto[]>([]);
  const [series, setSeries] = useState<SeriesDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async (): Promise<void> => {
    const [productItems, brandItems, seriesItems, tagItems] = await Promise.all([
      listAdminProducts(),
      listAdminBrands(),
      listSeries(),
      listTags(),
    ]);
    setProducts(productItems);
    setBrands(brandItems.filter(brand => brand.active));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request failed.');
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(product =>
      `${product.productCode} ${product.title} ${product.titleEn} ${product.brandCode}`
        .toLowerCase()
        .includes(needle)
    );
  }, [products, search]);

  if (loading) return <LoadingBlock label="Loading products… / 正在加载商品…" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBlock message={error} onRetry={load} />}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 text-sm flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search product code, name or brand"
              className="flex-1 outline-none bg-transparent"
              data-testid="admin-product-search"
            />
          </label>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowCreate(value => !value)}
              data-testid="product-new"
              className="h-10 px-4 rounded-xl bg-[#ff681e] text-white text-sm font-bold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> New product / 新建商品
            </button>
          )}
        </div>
        {showCreate && canWrite && (
          <CreateProductForm
            brands={brands}
            series={series}
            tags={tags}
            onSubmit={async input => {
              await run(() => createProduct(input), 'Product created as a draft. / 商品已创建（默认下架）。');
              setShowCreate(false);
            }}
          />
        )}
      </section>

      <div className="space-y-3">
        {visible.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            brands={brands}
            series={series}
            tags={tags}
            canWrite={canWrite}
            expanded={expanded === product.id}
            onToggle={() => setExpanded(expanded === product.id ? null : product.id)}
            run={run}
          />
        ))}
        {!visible.length && (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
            No products yet. Create the first draft product. / 暂无商品，请先新建。
          </div>
        )}
      </div>
    </div>
  );
};

const CreateProductForm: React.FC<{
  brands: BrandDto[];
  series: SeriesDto[];
  tags: TagDto[];
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}> = ({ brands, series, tags, onSubmit }) => {
  const [form, setForm] = useState({
    brandId: brands[0]?.id ?? '',
    productCode: '',
    title: '',
    titleEn: '',
    category: 'Business Backpacks',
    material: '',
    capacityOrSize: '',
    seriesId: '',
    tagIds: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: unknown) =>
    setForm(current => ({ ...current, [key]: value }));

  return (
    <form
      className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100"
      onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSubmit({
            ...form,
            seriesId: form.seriesId || null,
            brandId: form.brandId,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-xs font-semibold text-slate-700">
        Brand / 品牌
        <select
          value={form.brandId}
          onChange={event => set('brandId', event.target.value)}
          className={`${inputClass} mt-1`}
          required
        >
          {brands.map(brand => (
            <option key={brand.id} value={brand.id}>
              {brand.nameEn}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Product code / 手工款号
        <input
          value={form.productCode}
          onChange={event => set('productCode', event.target.value)}
          className={`${inputClass} mt-1 font-mono`}
          data-testid="product-code"
          required
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Chinese name / 中文名称
        <input
          value={form.title}
          onChange={event => set('title', event.target.value)}
          className={`${inputClass} mt-1`}
          data-testid="product-title-zh"
          required
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        English name
        <input
          value={form.titleEn}
          onChange={event => set('titleEn', event.target.value)}
          className={`${inputClass} mt-1`}
          data-testid="product-title-en"
          required
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Category
        <input
          value={form.category}
          onChange={event => set('category', event.target.value)}
          className={`${inputClass} mt-1`}
          required
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Series
        <select
          value={form.seriesId}
          onChange={event => set('seriesId', event.target.value)}
          className={`${inputClass} mt-1`}
        >
          <option value="">No series</option>
          {series.map(item => (
            <option key={item.id} value={item.id}>
              {item.nameEn}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Material
        <input
          value={form.material}
          onChange={event => set('material', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Size / capacity
        <input
          value={form.capacityOrSize}
          onChange={event => set('capacityOrSize', event.target.value)}
          className={`${inputClass} mt-1`}
        />
      </label>
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        {tags.map(tag => (
          <label
            key={tag.id}
            className="px-2.5 py-1 rounded-full border border-slate-200 text-[11px] flex items-center gap-1.5"
          >
            <input
              type="checkbox"
              checked={form.tagIds.includes(tag.id)}
              onChange={event =>
                set(
                  'tagIds',
                  event.target.checked
                    ? [...form.tagIds, tag.id]
                    : form.tagIds.filter(id => id !== tag.id)
                )
              }
            />
            {tag.nameEn}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={busy}
        data-testid="product-create-submit"
        className="sm:col-span-2 h-11 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create draft / 创建草稿'}
      </button>
    </form>
  );
};

interface DestructiveRequest {
  kind: OrderImpactKind;
  targetId: string;
  description: string;
  success: string;
  action: (token?: string) => Promise<unknown>;
}

const ProductCard: React.FC<{
  product: ProductDto;
  brands: BrandDto[];
  series: SeriesDto[];
  tags: TagDto[];
  canWrite: boolean;
  expanded: boolean;
  onToggle: () => void;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
}> = ({ product, brands, series, tags, canWrite, expanded, onToggle, run }) => {
  const primary = product.images.find(image => image.isPrimary) ?? product.images[0];
  const activeSkus = product.skus.filter(sku => sku.sellableStatus === 'active').length;
  const [impact, setImpact] = useState<
    (DestructiveRequest & { preview: OrderImpactDto }) | null
  >(null);
  const [impactError, setImpactError] = useState('');

  const requestDestructive = async (request: DestructiveRequest) => {
    setImpactError('');
    try {
      const preview = await getPendingOrderImpact(request.kind, request.targetId);
      if (preview.affectedOrders.length === 0) {
        await run(() => request.action(undefined), request.success);
        return;
      }
      setImpact({ ...request, preview });
    } catch (err) {
      setImpactError(err instanceof Error ? err.message : 'The order-impact preview failed.');
    }
  };

  const confirmImpact = async () => {
    if (!impact) return;
    await run(
      () => impact.action(impact.preview.impactToken),
      impact.success
    );
    setImpact(null);
  };

  return (
    <section
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
      data-testid="admin-product-card"
      data-product-code={product.productCode}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left"
      >
        <div className="w-14 h-14 rounded-xl bg-[#f3f3f1] overflow-hidden shrink-0">
          {primary && <img src={primary.url} alt="" className="w-full h-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono text-slate-400">
            {product.productCode} · {product.brandCode}
          </div>
          <div className="text-sm font-bold truncate">{product.titleEn}</div>
          <div className="text-[11px] text-slate-500 truncate">{product.title}</div>
        </div>
        <div className="hidden sm:block text-right text-[11px] text-slate-500">
          <div>
            {product.skus.length} SKU · {activeSkus} active
          </div>
          <div>{product.images.length} images</div>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
            product.published
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-50 text-slate-600 border-slate-200'
          }`}
        >
          {product.published ? 'Published' : 'Draft'}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-3 sm:p-4 space-y-5">
          <ProductEditor
            product={product}
            brands={brands}
            series={series}
            tags={tags}
            canWrite={canWrite}
            run={run}
          />
          <ImageManager product={product} canWrite={canWrite} run={run} />
          <SkuManager
            product={product}
            canWrite={canWrite}
            run={run}
            requestDestructive={requestDestructive}
          />
          {impactError && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800">
              {impactError}
            </div>
          )}
          {canWrite && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                data-testid={product.published ? 'product-unpublish' : 'product-publish'}
                onClick={() => {
                  if (!product.published) {
                    void run(() => setPublished(product.id, true), 'Product published.');
                    return;
                  }
                  void requestDestructive({
                    kind: 'product_unpublish',
                    targetId: product.id,
                    description:
                      'Unpublishing this product cancels every pending-confirmation order that contains it.',
                    success: 'Product unpublished and affected pending orders cancelled.',
                    action: token =>
                      setPublished(product.id, false, {
                        confirmAffectedOrders: true,
                        impactToken: token,
                      }),
                  });
                }}
                className={`h-10 px-4 rounded-xl text-sm font-bold ${
                  product.published
                    ? 'bg-white border border-slate-300'
                    : 'bg-[#ff681e] text-white'
                }`}
              >
                {product.published ? 'Unpublish / 下架' : 'Publish / 上架'}
              </button>
              <span className="text-[11px] text-slate-500 self-center">
                Publishing requires at least one active SKU and one image.
              </span>
            </div>
          )}
          {impact && (
            <div
              className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
              role="dialog"
              aria-modal="true"
              data-testid="impact-dialog"
            >
              <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
                <h3 className="text-base font-extrabold text-rose-700">
                  Pending orders will be cancelled
                </h3>
                <p className="text-xs text-slate-600">{impact.description}</p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {impact.preview.affectedOrders.map(order => (
                    <div
                      key={order.id}
                      className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800 flex flex-wrap gap-2"
                    >
                      <span className="font-mono font-bold">{order.orderNo}</span>
                      <span>{order.companyCode}</span>
                      <span className="ml-auto">{usdFromCents(order.referenceTotalCents)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">
                  The backend re-checks this exact set inside the transaction. If another order is
                  submitted or cancelled first, the action is rejected and you must review again.
                  Customers and their assigned salesperson receive a pending notification record;
                  no email is sent in this phase.
                </p>
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setImpact(null)}
                    className="min-h-[42px] px-4 rounded-xl border border-slate-300 text-xs font-semibold"
                    data-testid="impact-cancel"
                  >
                    Keep current state
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmImpact()}
                    className="min-h-[42px] px-4 rounded-xl bg-rose-600 text-white text-xs font-bold"
                    data-testid="impact-confirm"
                  >
                    Confirm and cancel {impact.preview.affectedOrders.length} order(s)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const ProductEditor: React.FC<{
  product: ProductDto;
  brands: BrandDto[];
  series: SeriesDto[];
  tags: TagDto[];
  canWrite: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
}> = ({ product, brands, series, tags, canWrite, run }) => {
  const [form, setForm] = useState({
    productCode: product.productCode,
    brandId: product.brandId,
    title: product.title,
    titleEn: product.titleEn,
    description: product.description,
    descriptionEn: product.descriptionEn,
    category: product.category,
    material: product.material,
    capacityOrSize: product.capacityOrSize,
    seriesId: product.seriesId ?? '',
    tagIds: product.tagIds,
  });
  useEffect(() => {
    setForm({
      productCode: product.productCode,
      brandId: product.brandId,
      title: product.title,
      titleEn: product.titleEn,
      description: product.description,
      descriptionEn: product.descriptionEn,
      category: product.category,
      material: product.material,
      capacityOrSize: product.capacityOrSize,
      seriesId: product.seriesId ?? '',
      tagIds: product.tagIds,
    });
  }, [product]);

  return (
    <form
      className="grid sm:grid-cols-2 gap-3"
      onSubmit={event => {
        event.preventDefault();
        void run(
          () => updateProduct(product.id, { ...form, seriesId: form.seriesId || null }),
          'Product saved. / 商品已保存。'
        );
      }}
    >
      <label className="text-xs font-semibold text-slate-700">
        Product code
        <input
          value={form.productCode}
          onChange={event => setForm({ ...form, productCode: event.target.value })}
          className={`${inputClass} mt-1 font-mono`}
          disabled={!canWrite}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Brand
        <select
          value={form.brandId}
          onChange={event => setForm({ ...form, brandId: event.target.value })}
          className={`${inputClass} mt-1`}
          disabled={!canWrite}
        >
          {brands.map(brand => (
            <option key={brand.id} value={brand.id}>
              {brand.nameEn}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-700">
        中文名称
        <input
          value={form.title}
          onChange={event => setForm({ ...form, title: event.target.value })}
          className={`${inputClass} mt-1`}
          disabled={!canWrite}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        English name
        <input
          value={form.titleEn}
          onChange={event => setForm({ ...form, titleEn: event.target.value })}
          className={`${inputClass} mt-1`}
          disabled={!canWrite}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Category
        <input
          value={form.category}
          onChange={event => setForm({ ...form, category: event.target.value })}
          className={`${inputClass} mt-1`}
          disabled={!canWrite}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Series
        <select
          value={form.seriesId}
          onChange={event => setForm({ ...form, seriesId: event.target.value })}
          className={`${inputClass} mt-1`}
          disabled={!canWrite}
        >
          <option value="">No series</option>
          {series.map(item => (
            <option key={item.id} value={item.id}>
              {item.nameEn}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Material
        <input
          value={form.material}
          onChange={event => setForm({ ...form, material: event.target.value })}
          className={`${inputClass} mt-1`}
          disabled={!canWrite}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Size / capacity
        <input
          value={form.capacityOrSize}
          onChange={event => setForm({ ...form, capacityOrSize: event.target.value })}
          className={`${inputClass} mt-1`}
          disabled={!canWrite}
        />
      </label>
      <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
        English description
        <textarea
          value={form.descriptionEn}
          onChange={event => setForm({ ...form, descriptionEn: event.target.value })}
          className="w-full min-h-[70px] p-3 rounded-xl border border-slate-300 text-sm mt-1"
          disabled={!canWrite}
        />
      </label>
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        {tags.map(tag => (
          <label
            key={tag.id}
            className="px-2.5 py-1 rounded-full border border-slate-200 text-[11px] flex items-center gap-1.5"
          >
            <input
              type="checkbox"
              checked={form.tagIds.includes(tag.id)}
              disabled={!canWrite}
              onChange={event =>
                setForm({
                  ...form,
                  tagIds: event.target.checked
                    ? [...form.tagIds, tag.id]
                    : form.tagIds.filter(id => id !== tag.id),
                })
              }
            />
            {tag.nameEn}
          </label>
        ))}
      </div>
      {canWrite && (
        <button
          type="submit"
          className="sm:col-span-2 h-10 rounded-xl bg-slate-900 text-white text-sm font-bold"
        >
          Save product / 保存商品
        </button>
      )}
    </form>
  );
};

const ImageManager: React.FC<{
  product: ProductDto;
  canWrite: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
}> = ({ product, canWrite, run }) => {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700">
          Images / 图片 <span className="text-slate-400 font-normal">({product.images.length})</span>
        </div>
        {canWrite && (
          <label className="h-9 px-3 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
            <ImagePlus className="w-4 h-4" />
            {busy ? 'Uploading…' : 'Upload / 上传'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              data-testid="image-upload"
              onChange={async event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setBusy(true);
                try {
                  await run(() => uploadProductImage(product.id, file), 'Image uploaded.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {product.images.map((image, index) => (
          <div
            key={image.id}
            className="relative rounded-xl overflow-hidden border border-slate-200 bg-[#f3f3f1]"
          >
            <img src={image.url} alt="" className="w-full aspect-square object-cover" />
            <div className="absolute top-1 left-1 flex gap-1">
              {image.isPrimary && (
                <span className="px-1.5 py-0.5 rounded bg-[#ff681e] text-white text-[9px] font-bold">
                  PRIMARY
                </span>
              )}
            </div>
            {canWrite && (
              <div className="absolute bottom-1 right-1 flex gap-1">
                <button
                  type="button"
                  title="Set primary"
                  onClick={() => run(() => setPrimaryImage(product.id, image.id), 'Primary image set.')}
                  className="w-7 h-7 rounded bg-white/90 grid place-items-center"
                >
                  <Star className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => {
                    const ids = product.images.map(item => item.id);
                    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                    void run(() => reorderImages(product.id, ids), 'Image order saved.');
                  }}
                  className="w-7 h-7 rounded bg-white/90 grid place-items-center disabled:opacity-40"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Remove"
                  onClick={() => run(() => removeImage(product.id, image.id), 'Image removed.')}
                  className="w-7 h-7 rounded bg-white/90 grid place-items-center text-rose-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
        {!product.images.length && (
          <div className="col-span-full text-[11px] text-slate-500">
            No images yet. Publishing requires at least one image.
          </div>
        )}
      </div>
    </div>
  );
};

const SkuManager: React.FC<{
  product: ProductDto;
  canWrite: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
  requestDestructive: (request: DestructiveRequest) => Promise<void>;
}> = ({ product, canWrite, run, requestDestructive }) => {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    skuCode: '',
    colorName: '',
    colorNameEn: '',
    colorHex: '#1c1c1e',
    price: '38.00',
    imageId: '',
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700">
          SKUs / 规格 <span className="text-slate-400 font-normal">({product.skus.length})</span>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setAdding(value => !value)}
            data-testid="sku-new"
            className="h-9 px-3 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> New SKU / 新增
          </button>
        )}
      </div>

      {product.skus.map(sku => (
        <SkuRow
          key={sku.id}
          sku={sku}
          canWrite={canWrite}
          run={run}
          requestDestructive={requestDestructive}
        />
      ))}

      {adding && canWrite && (
        <form
          className="grid sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200"
          onSubmit={event => {
            event.preventDefault();
            void run(
              () =>
                createSku(product.id, {
                  skuCode: form.skuCode,
                  colorName: form.colorName,
                  colorNameEn: form.colorNameEn,
                  colorHex: form.colorHex,
                  basePriceCents: Math.round(Number(form.price) * 100),
                  imageId: form.imageId || null,
                }),
              'SKU created.'
            ).then(() => {
              setAdding(false);
              setForm({
                skuCode: '',
                colorName: '',
                colorNameEn: '',
                colorHex: '#1c1c1e',
                price: '38.00',
                imageId: '',
              });
            });
          }}
        >
          <label className="text-xs font-semibold text-slate-700">
            SKU code
            <input
              value={form.skuCode}
              onChange={event => setForm({ ...form, skuCode: event.target.value })}
              className={`${inputClass} mt-1 font-mono`}
              data-testid="sku-code"
              required
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Colour EN
            <input
              value={form.colorNameEn}
              onChange={event => setForm({ ...form, colorNameEn: event.target.value })}
              className={`${inputClass} mt-1`}
              data-testid="sku-color-en"
              required
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            颜色中文
            <input
              value={form.colorName}
              onChange={event => setForm({ ...form, colorName: event.target.value })}
              className={`${inputClass} mt-1`}
              data-testid="sku-color-zh"
              required
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            USD price
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.price}
              onChange={event => setForm({ ...form, price: event.target.value })}
              className={`${inputClass} mt-1`}
              data-testid="sku-price"
              required
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Colour hex
            <input
              value={form.colorHex}
              onChange={event => setForm({ ...form, colorHex: event.target.value })}
              className={`${inputClass} mt-1 font-mono`}
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            SKU image
            <select
              value={form.imageId}
              onChange={event => setForm({ ...form, imageId: event.target.value })}
              className={`${inputClass} mt-1`}
            >
              <option value="">Use product image</option>
              {product.images.map((image, index) => (
                <option key={image.id} value={image.id}>
                  Image {index + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            data-testid="sku-create-submit"
            className="sm:col-span-2 h-10 rounded-xl bg-slate-900 text-white text-sm font-bold"
          >
            Create SKU / 创建规格
          </button>
        </form>
      )}
    </div>
  );
};

const SkuRow: React.FC<{
  sku: SkuDto;
  canWrite: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
  requestDestructive: (request: DestructiveRequest) => Promise<void>;
}> = ({ sku, canWrite, run, requestDestructive }) => {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(usd(sku.basePriceCents));

  return (
    <div className="p-3 rounded-xl border border-slate-200 text-xs space-y-2" data-testid="sku-row">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="w-5 h-5 rounded-full border border-slate-300"
          style={{ backgroundColor: sku.colorHex }}
        />
        <span className="font-mono text-[10px] text-slate-400">{sku.skuCode}</span>
        <span className="font-semibold">{sku.colorNameEn}</span>
        <span className="ml-auto font-bold">${usd(sku.basePriceCents)}</span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            sku.sellableStatus === 'active'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}
        >
          {sku.sellableStatus}
        </span>
        {canWrite && (
          <button
            type="button"
            onClick={() => setEditing(value => !value)}
            className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] font-semibold"
          >
            Edit
          </button>
        )}
      </div>
      {editing && canWrite && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            void run(
              () =>
                updateSku(sku.id, {
                  basePriceCents: Math.round(Number(price) * 100),
                }),
              'SKU saved.'
            ).then(() => setEditing(false));
          }}
        >
          <label className="text-[11px] font-semibold text-slate-600">
            Price USD
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={price}
              onChange={event => setPrice(event.target.value)}
              className={`${inputClass} mt-1 w-28`}
            />
          </label>
          <button type="submit" className="h-10 px-3 rounded-xl bg-slate-900 text-white font-bold">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              if (sku.sellableStatus !== 'active') {
                void run(
                  () => updateSku(sku.id, { sellableStatus: 'active' }),
                  'SKU status updated.'
                );
                return;
              }
              void requestDestructive({
                kind: 'sku_discontinue',
                targetId: sku.id,
                description:
                  'Discontinuing this SKU cancels every pending-confirmation order that contains it.',
                success: 'SKU discontinued and affected pending orders cancelled.',
                action: token =>
                  updateSku(sku.id, {
                    sellableStatus: 'discontinued',
                    confirmAffectedOrders: true,
                    impactToken: token,
                  }),
              });
            }}
            className="h-10 px-3 rounded-xl border border-slate-300 font-semibold"
          >
            {sku.sellableStatus === 'active' ? 'Discontinue' : 'Reactivate'}
          </button>
        </form>
      )}
    </div>
  );
};
