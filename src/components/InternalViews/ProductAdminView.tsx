import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Layers,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useApp, type AdminProductInput, type AdminSkuInput } from '../../context/AppContext';
import { DEMO_IMAGE_LIBRARY } from '../../data/demoImageLibrary';
import { calculateSKUAvailableStock, SKU_MOQ } from '../../utils/rules';
import type {
  FeatureTagDefinition,
  FeatureTagTone,
  Product,
  ProductSKU,
  SeriesDefinition,
} from '../../types';
import { customerProductTitle, customerSkuColor } from '../../utils/customerDisplay';

const TONES: FeatureTagTone[] = ['orange', 'blue', 'sky', 'green', 'grey', 'purple'];
const CATEGORIES: Product['category'][] = [
  'Business Backpacks',
  'Travel Luggage',
  'Urban Commuter',
  'Executive Briefcases',
];
const TONE_STYLES: Record<FeatureTagTone, string> = {
  orange: 'bg-[#fff1e8] text-[#9a3d00] border-[#ffd7c2]',
  blue: 'bg-[#eaf2ff] text-[#1c4f9c] border-[#cbdcff]',
  sky: 'bg-[#ecf8fb] text-[#1c5e70] border-[#c8eaf2]',
  green: 'bg-[#eaf7f0] text-[#146b51] border-[#c7e9d8]',
  grey: 'bg-[#f1f1ef] text-[#52575a] border-[#e0e0dc]',
  purple: 'bg-[#f3edff] text-[#5a369c] border-[#e0d3ff]',
};

function blankProductForm(series: SeriesDefinition[]): AdminProductInput {
  const image = DEMO_IMAGE_LIBRARY[0].url;
  return {
    brandId: 'brand-aoking',
    productCode: '',
    title: '',
    titleEn: '',
    category: 'Business Backpacks',
    description: '',
    descriptionEn: '',
    material: '',
    capacityOrSize: '',
    seriesId: series.find(item => item.active)?.id,
    tagCodes: [],
    primaryImage: image,
    galleryImages: [image],
  };
}

function productToForm(product: Product): AdminProductInput {
  return {
    brandId: product.brand_id,
    productCode: product.product_code,
    title: product.title,
    titleEn: product.title_en ?? '',
    category: product.category,
    description: product.description,
    descriptionEn: product.description_en ?? '',
    material: product.material,
    capacityOrSize: product.capacity_or_size,
    seriesId: product.series_id,
    tagCodes: [...(product.tag_codes ?? [])],
    primaryImage: product.primary_image,
    galleryImages: [...product.gallery_images],
  };
}

function blankSkuForm(product: Product): AdminSkuInput & { onHand: number } {
  return {
    skuCode: `${product.product_code}-`,
    colorName: '',
    colorNameEn: '',
    colorHex: '#343b3c',
    basePriceUsd: 30,
    sellableStatus: 'active',
    imageUrl: '',
    onHand: 0,
  };
}

function skuForm(sku: ProductSKU): AdminSkuInput & { onHand: number } {
  return {
    skuCode: sku.sku_code,
    colorName: sku.color_name,
    colorNameEn: sku.color_name_en ?? '',
    colorHex: sku.color_hex,
    basePriceUsd: sku.base_price_usd,
    sellableStatus: sku.sellable_status,
    imageUrl: sku.image_url ?? '',
    onHand: 0,
  };
}

export const ProductAdminView: React.FC = () => {
  const {
    currentRole,
    products,
    brands,
    series,
    featureTags,
    inventory,
    adminCreateProduct,
    adminUpdateProduct,
    adminSetProductActive,
    adminCreateSku,
    adminUpdateSku,
    adminSaveSeries,
    adminSaveFeatureTags,
  } = useApp();

  const [search, setSearch] = useState('');
  const [seriesFilter, setSeriesFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedProductId, setExpandedProductId] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [productForm, setProductForm] = useState<AdminProductInput>(blankProductForm(series));
  const [formError, setFormError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [productMetaError, setProductMetaError] = useState('');
  const [skuForProduct, setSkuForProduct] = useState('');
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
  const [skuFormState, setSkuFormState] = useState<(AdminSkuInput & { onHand: number }) | null>(
    null
  );
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const activeSeries = useMemo(
    () => [...series].sort((a, b) => a.order - b.order),
    [series]
  );
  const activeTags = useMemo(
    () => [...featureTags].sort((a, b) => a.order - b.order),
    [featureTags]
  );
  const brandName = (id: string) => brands.find(brand => brand.id === id)?.name_en ?? id;
  const seriesName = (id?: string) =>
    series.find(item => item.id === id)?.nameEn ?? '未分配系列';
  const tagName = (code: string) =>
    featureTags.find(tag => tag.code === code)?.nameEn ?? code;
  const tagTone = (code: string) =>
    featureTags.find(tag => tag.code === code)?.tone ?? 'grey';
  const activeSkuCount = (product: Product) =>
    product.skus.filter(sku => sku.sellable_status === 'active').length;
  const productListed = (product: Product) => product.active !== false;

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter(product => {
      if (seriesFilter !== 'all' && product.series_id !== seriesFilter) return false;
      if (categoryFilter !== 'all' && product.category !== categoryFilter) return false;
      if (!query) return true;
      return [
        product.product_code,
        product.title,
        product.title_en,
        customerProductTitle(product),
        product.category,
        product.material,
        product.capacity_or_size,
        ...[...product.skus.map(sku => sku.sku_code)],
        ...(product.tag_codes ?? []).map(tagName),
        seriesName(product.series_id),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [products, search, seriesFilter, categoryFilter, series, featureTags]);

  const showMessage = (message: string) => {
    setActionMessage(message);
    window.setTimeout(() => setActionMessage(''), 4000);
  };

  const openCreate = () => {
    setEditingProductId(null);
    setProductForm(blankProductForm(series));
    setFormError('');
    setEditorOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingProductId(product.id);
    setProductForm(productToForm(product));
    setFormError('');
    setEditorOpen(true);
  };

  const saveProduct = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (editingProductId) {
      const result = adminUpdateProduct(editingProductId, productForm);
      if (!result.success) {
        setFormError(result.error ?? '保存失败');
        return;
      }
      setEditorOpen(false);
      setFormError('');
      showMessage('商品信息已保存；历史订单快照未改变');
      return;
    }
    const result = adminCreateProduct(productForm);
    if (!result.success || !result.productId) {
      setFormError(result.error ?? '保存失败');
      return;
    }
    const productId = result.productId;
    setEditorOpen(false);
    setFormError('');
    setSearch('');
    setSeriesFilter('all');
    setCategoryFilter('all');
    setExpandedProductId(productId);
    showMessage('商品草稿已创建，请添加 SKU、图片并上架');
    window.setTimeout(() => {
      const element = listRef.current?.querySelector<HTMLElement>(
        `[data-product-id="${productId}"]`
      );
      element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      element?.querySelector<HTMLElement>('[data-product-title]')?.focus();
    }, 50);
  };

  const toggleProduct = (product: Product) => {
    const next = !productListed(product);
    const result = adminSetProductActive(product.id, next);
    if (!result.success) {
      setProductMetaError(result.error ?? '上下架失败');
      return;
    }
    setProductMetaError('');
    showMessage(next ? '商品已上架，客户目录即时更新' : '商品已下架');
  };

  const beginSku = (product: Product, sku?: ProductSKU) => {
    setSkuForProduct(product.id);
    setEditingSkuId(sku?.id ?? null);
    setSkuFormState(sku ? skuForm(sku) : blankSkuForm(product));
    setProductMetaError('');
  };

  const saveSku = (event: React.FormEvent) => {
    event.preventDefault();
    if (!skuFormState || !skuForProduct) return;
    const input: AdminSkuInput = {
      skuCode: skuFormState.skuCode,
      colorName: skuFormState.colorName,
      colorNameEn: skuFormState.colorNameEn,
      colorHex: skuFormState.colorHex,
      basePriceUsd: Number(skuFormState.basePriceUsd),
      sellableStatus: skuFormState.sellableStatus,
      imageUrl: skuFormState.imageUrl || undefined,
    };
    const result = editingSkuId
      ? adminUpdateSku(skuForProduct, editingSkuId, input)
      : adminCreateSku(skuForProduct, input, Number(skuFormState.onHand));
    if (!result.success) {
      setProductMetaError(result.error ?? 'SKU 保存失败');
      return;
    }
    setProductMetaError('');
    setSkuForProduct('');
    setSkuFormState(null);
    setEditingSkuId(null);
    showMessage(editingSkuId ? 'SKU 已更新' : 'SKU 已创建');
  };

  if (currentRole !== 'admin') {
    return (
      <div className="max-w-xl mx-auto p-8 bg-white border border-slate-200 rounded-2xl text-sm text-slate-600">
        商品目录管理仅对管理员角色开放。当前为前端角色模拟，不是服务端权限。
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[1.7px] text-[#8f9191]">
            ADMIN · CATALOG OPERATIONS
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#151515] mt-1">
            商品目录管理 / Product catalogue
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            仅管理员可编辑。刷新后本地 Mock 修改可能丢失，不连接云端或正式数据库。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTaxonomyOpen(true)}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[#e8e8e6] bg-white text-xs font-bold text-[#343434]"
          >
            <Settings2 className="w-4 h-4" />
            系列与标签
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[#ff681e] text-white text-xs font-bold shadow-sm"
            data-testid="admin-add-product"
          >
            <Plus className="w-4 h-4" />
            新建商品
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 rounded-[10px] bg-[#eaf7f0] border border-[#c7e9d8] text-xs font-semibold text-[#146b51]">
          {actionMessage}
        </div>
      )}
      {productMetaError && (
        <div role="alert" className="p-3 rounded-[10px] bg-[#fff0ed] border border-[#ffd3ca] text-xs font-semibold text-[#9d2f1f]">
          {productMetaError}
        </div>
      )}

      <div className="bg-white border border-[#eaeae7] rounded-[14px] p-3">
        <div className="flex flex-col lg:flex-row gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search products</span>
            <Search className="w-4 h-4 text-[#999] absolute left-3.5 top-3.5" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="搜索款号、名称、SKU、系列或标签..."
              className="w-full h-11 pl-10 pr-3 rounded-[9px] border border-[#e8e8e6] bg-white text-sm outline-none focus:border-[#ff9e6c]"
            />
          </label>
          <select
            value={seriesFilter}
            onChange={event => setSeriesFilter(event.target.value)}
            aria-label="Filter by series"
            className="h-11 px-3 rounded-[9px] border border-[#e8e8e6] bg-white text-xs font-semibold"
          >
            <option value="all">全部系列 / All series</option>
            {activeSeries.map(item => (
              <option key={item.id} value={item.id}>
                {item.nameEn}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={event => setCategoryFilter(event.target.value)}
            aria-label="Filter by category"
            className="h-11 px-3 rounded-[9px] border border-[#e8e8e6] bg-white text-xs font-semibold"
          >
            <option value="all">全部分类 / All categories</option>
            {CATEGORIES.map(category => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div ref={listRef} className="space-y-3" data-testid="admin-product-list">
        {filteredProducts.map(product => {
          const expanded = expandedProductId === product.id;
          const listed = productListed(product);
          const activeSkus = activeSkuCount(product);
          return (
            <article
              key={product.id}
              data-product-id={product.id}
              data-testid="admin-product-row"
              className={`bg-white border rounded-[14px] overflow-hidden ${
                expanded ? 'border-[#171717] shadow-sm' : 'border-[#eaeae7]'
              } ${listed ? '' : 'bg-[#fafaf9]'}`}
            >
              <button
                type="button"
                onClick={() => {
                  setExpandedProductId(expanded ? '' : product.id);
                  setSkuForProduct('');
                  setProductMetaError('');
                }}
                className="w-full flex items-center gap-3 p-3 sm:p-4 text-left"
                aria-expanded={expanded}
                data-testid="admin-product-row-button"
              >
                <img
                  src={product.primary_image}
                  alt=""
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-[10px] object-cover border border-[#eee] shrink-0"
                  loading="lazy"
                  decoding="async"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong
                      tabIndex={-1}
                      data-product-title
                      className="text-sm font-bold text-[#151515] truncate max-w-full"
                    >
                      {customerProductTitle(product)}
                    </strong>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        listed
                          ? 'bg-[#eaf7f0] text-[#146b51] border border-[#c7e9d8]'
                          : 'bg-[#fff0ed] text-[#9d2f1f] border border-[#ffd3ca]'
                      }`}
                    >
                      {listed ? '已上架' : '草稿'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {product.title} · {product.product_code}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-500">
                    <span>{brandName(product.brand_id)}</span>
                    <span>·</span>
                    <span>{product.category}</span>
                    <span>·</span>
                    <span>{seriesName(product.series_id)}</span>
                    <span>·</span>
                    <span>
                      {product.skus.length} SKU / {activeSkus} 启用
                    </span>
                  </div>
                  {(product.tag_codes ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(product.tag_codes ?? []).map(code => (
                        <span
                          key={code}
                          className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${TONE_STYLES[tagTone(code)]}`}
                        >
                          {tagName(code)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {expanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                )}
              </button>

              {expanded && (
                <div className="border-t border-[#eee] p-3 sm:p-5 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-[9px] border border-[#e8e8e6] bg-white text-xs font-bold"
                      data-testid="admin-edit-product"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      编辑商品
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleProduct(product)}
                      className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-[9px] text-xs font-bold ${
                        listed
                          ? 'bg-[#fff0ed] text-[#9d2f1f] border border-[#ffd3ca]'
                          : 'bg-[#171717] text-white'
                      }`}
                      data-testid="admin-toggle-product"
                    >
                      {listed ? '下架商品' : '上架商品'}
                    </button>
                    <button
                      type="button"
                      onClick={() => beginSku(product)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-[9px] bg-[#ff681e] text-white text-xs font-bold"
                      data-testid="admin-add-sku"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      新增 SKU
                    </button>
                    {!listed && (
                      <span className="text-[10px] text-slate-500 self-center">
                        上架条件：至少一个启用 SKU + 一张有效图片
                      </span>
                    )}
                  </div>

                  {product.skus.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-[#ddd] p-4 text-xs text-slate-500">
                      还没有 SKU。先新增 SKU，再设置图片并上架。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {product.skus.map(sku => (
                        <div
                          key={sku.id}
                          className="border border-[#eee] rounded-[10px] p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                              className="w-7 h-7 rounded-full border border-black/15 shrink-0"
                              style={{ background: sku.color_hex }}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold font-mono text-[#151515]">
                                {sku.sku_code}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {sku.color_name}
                                {sku.color_name_en ? ` / ${sku.color_name_en}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs font-mono font-bold text-[#151515]">
                            ${sku.base_price_usd.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            可订 {calculateSKUAvailableStock(sku.id, inventory).totalAvailable} PCS
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              sku.sellable_status === 'active'
                                ? 'bg-[#eaf7f0] text-[#146b51]'
                                : 'bg-[#f1f1ef] text-[#666]'
                            }`}
                          >
                            {sku.sellable_status === 'active' ? '启用' : '停售'}
                          </span>
                          <button
                            type="button"
                            onClick={() => beginSku(product, sku)}
                            data-testid="admin-edit-sku"
                            className="min-h-[36px] px-3 rounded-[8px] border border-[#e8e8e6] text-xs font-bold"
                          >
                            编辑
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {skuForProduct === product.id && skuFormState && (
                    <form
                      onSubmit={saveSku}
                      className="rounded-[10px] border border-[#ffd7c2] bg-[#fffaf7] p-3 space-y-3"
                      data-testid="admin-sku-form"
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-xs text-[#151515]">
                          {editingSkuId ? '编辑 SKU' : '新增 SKU'}
                        </strong>
                        <button
                          type="button"
                          onClick={() => setSkuForProduct('')}
                          className="text-[11px] text-slate-500"
                        >
                          取消
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-[11px] font-semibold text-slate-600">
                          SKU 编码
                          <input
                            value={skuFormState.skuCode}
                            onChange={event =>
                              setSkuFormState({ ...skuFormState, skuCode: event.target.value })
                            }
                            className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white font-mono text-xs"
                            required
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          颜色名称 (中文)
                          <input
                            value={skuFormState.colorName}
                            onChange={event =>
                              setSkuFormState({ ...skuFormState, colorName: event.target.value })
                            }
                            className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white text-xs"
                            required
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          Colour name (English)
                          <input
                            value={skuFormState.colorNameEn}
                            onChange={event =>
                              setSkuFormState({ ...skuFormState, colorNameEn: event.target.value })
                            }
                            className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white text-xs"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          颜色预览色块
                          <input
                            type="color"
                            value={skuFormState.colorHex}
                            onChange={event =>
                              setSkuFormState({ ...skuFormState, colorHex: event.target.value })
                            }
                            className="mt-1 w-full h-10 rounded-[8px] border border-[#e8e8e6] bg-white"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          基础批发价 (USD)
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={skuFormState.basePriceUsd}
                            onChange={event =>
                              setSkuFormState({
                                ...skuFormState,
                                basePriceUsd: Number(event.target.value),
                              })
                            }
                            className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white font-mono text-xs"
                            required
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          可售状态
                          <select
                            value={skuFormState.sellableStatus}
                            onChange={event =>
                              setSkuFormState({
                                ...skuFormState,
                                sellableStatus: event.target.value as ProductSKU['sellable_status'],
                              })
                            }
                            className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white text-xs"
                          >
                            <option value="active">启用</option>
                            <option value="discontinued">停售</option>
                          </select>
                        </label>
                        {!editingSkuId && (
                          <label className="text-[11px] font-semibold text-slate-600">
                            初始在库 (PCS)
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={skuFormState.onHand}
                              onChange={event =>
                                setSkuFormState({
                                  ...skuFormState,
                                  onHand: Number(event.target.value),
                                })
                              }
                              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white font-mono text-xs"
                            />
                          </label>
                        )}
                        <label className="text-[11px] font-semibold text-slate-600 sm:col-span-2">
                          SKU 独立图片（可选，空则使用商品主图）
                          <select
                            value={skuFormState.imageUrl}
                            onChange={event =>
                              setSkuFormState({ ...skuFormState, imageUrl: event.target.value })
                            }
                            className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white text-xs"
                          >
                            <option value="">使用商品主图</option>
                            {[product.primary_image, ...product.gallery_images]
                              .filter((url, index, list) => url && list.indexOf(url) === index)
                              .map(url => {
                                const image = DEMO_IMAGE_LIBRARY.find(item => item.url === url);
                                return (
                                  <option key={url} value={url}>
                                    {image?.labelEn ?? 'Product image'}
                                  </option>
                                );
                              })}
                          </select>
                        </label>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="submit"
                          className="min-h-[40px] scroll-mt-24 px-4 rounded-[8px] bg-[#171717] text-white text-xs font-bold"
                          data-testid="admin-save-sku"
                        >
                          保存 SKU
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="p-8 text-center rounded-[14px] border border-dashed border-[#ddd] text-xs text-slate-500">
            没有匹配的商品。清除筛选或新建商品。
          </div>
        )}
      </div>

      {editorOpen && (
        <ProductEditor
          title={editingProductId ? '编辑商品 / Edit product' : '新建商品 / New product'}
          form={productForm}
          setForm={setProductForm}
          brands={brands}
          series={activeSeries}
          tags={activeTags}
          error={formError}
          onSubmit={saveProduct}
          onClose={() => setEditorOpen(false)}
        />
      )}

      {taxonomyOpen && (
        <TaxonomyDialog
          series={series}
          tags={featureTags}
          onSaveSeries={next => {
            const result = adminSaveSeries(next);
            return result.success ? null : result.error ?? '保存失败';
          }}
          onSaveTags={next => {
            const result = adminSaveFeatureTags(next);
            return result.success ? null : result.error ?? '保存失败';
          }}
          onClose={() => setTaxonomyOpen(false)}
        />
      )}
    </div>
  );
};

const ProductEditor: React.FC<{
  title: string;
  form: AdminProductInput;
  setForm: (form: AdminProductInput) => void;
  brands: { id: string; name: string; name_en?: string }[];
  series: SeriesDefinition[];
  tags: FeatureTagDefinition[];
  error: string;
  onSubmit: (event?: React.FormEvent) => void;
  onClose: () => void;
}> = ({ title, form, setForm, brands, series, tags, error, onSubmit, onClose }) => {
  const set = <K extends keyof AdminProductInput>(key: K, value: AdminProductInput[K]) =>
    setForm({ ...form, [key]: value });
  const toggleTag = (code: string) =>
    set(
      'tagCodes',
      form.tagCodes.includes(code)
        ? form.tagCodes.filter(item => item !== code)
        : [...form.tagCodes, code]
    );
  const choosePrimary = (url: string) =>
    setForm({
      ...form,
      primaryImage: url,
      galleryImages: form.galleryImages.includes(url)
        ? form.galleryImages
        : [url, ...form.galleryImages],
    });
  const toggleGallery = (url: string) => {
    if (form.galleryImages.includes(url)) {
      const next = form.galleryImages.filter(item => item !== url);
      setForm({
        ...form,
        galleryImages: next,
        primaryImage: form.primaryImage === url ? next[0] ?? '' : form.primaryImage,
      });
    } else {
      setForm({ ...form, galleryImages: [...form.galleryImages, url] });
    }
  };
  const moveGallery = (index: number, direction: -1 | 1) => {
    const next = [...form.galleryImages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setForm({ ...form, galleryImages: next });
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-[2px] flex items-stretch sm:items-center justify-center sm:p-4">
      <form
        onSubmit={onSubmit}
        className="w-full sm:max-w-3xl max-h-[100dvh] sm:max-h-[92dvh] overflow-y-auto bg-white sm:rounded-[16px] border border-[#e8e8e6] p-4 sm:p-6 space-y-4"
        data-testid="admin-product-editor"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#151515]">{title}</h2>
            <p className="text-[11px] text-slate-500 mt-1">
              款号人工填写并检查重复；不会自动生成或套用其他系统编码。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product editor"
            className="w-10 h-10 rounded-[9px] border border-[#e8e8e6] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-[11px] font-semibold text-slate-600">
            款号 / Product code
            <input
              value={form.productCode}
              onChange={event => set('productCode', event.target.value)}
              placeholder="例如 AK-9042（手工填写）"
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] font-mono text-sm"
              required
              data-testid="admin-product-code"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            品牌 / Brand
            <select
              value={form.brandId}
              onChange={event => set('brandId', event.target.value)}
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white text-sm"
            >
              {brands.map(brand => (
                <option key={brand.id} value={brand.id}>
                  {brand.name_en ?? brand.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            中文名称
            <input
              value={form.title}
              onChange={event => set('title', event.target.value)}
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] text-sm"
              required
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            English customer title
            <input
              value={form.titleEn}
              onChange={event => set('titleEn', event.target.value)}
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] text-sm"
              required
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            分类 / Category
            <select
              value={form.category}
              onChange={event => set('category', event.target.value as Product['category'])}
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white text-sm"
            >
              {CATEGORIES.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            系列 / Series
            <select
              value={form.seriesId ?? ''}
              onChange={event => set('seriesId', event.target.value || undefined)}
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] bg-white text-sm"
            >
              <option value="">未分配 / No series</option>
              {series.map(item => (
                <option key={item.id} value={item.id}>
                  {item.nameEn} / {item.nameZh}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            材质 / Material
            <input
              value={form.material}
              onChange={event => set('material', event.target.value)}
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            尺寸/容量 / Size
            <input
              value={form.capacityOrSize}
              onChange={event => set('capacityOrSize', event.target.value)}
              className="mt-1 w-full h-10 px-2.5 rounded-[8px] border border-[#e8e8e6] text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 sm:col-span-2">
            中文描述
            <textarea
              value={form.description}
              onChange={event => set('description', event.target.value)}
              rows={2}
              className="mt-1 w-full p-2.5 rounded-[8px] border border-[#e8e8e6] text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600 sm:col-span-2">
            English customer description
            <textarea
              value={form.descriptionEn}
              onChange={event => set('descriptionEn', event.target.value)}
              rows={2}
              className="mt-1 w-full p-2.5 rounded-[8px] border border-[#e8e8e6] text-sm"
            />
          </label>
        </div>

        <fieldset className="border border-[#e8e8e6] rounded-[10px] p-3">
          <legend className="px-1 text-[11px] font-bold text-slate-600">功能标签 / Feature tags</legend>
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <label key={tag.code} className="inline-flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={form.tagCodes.includes(tag.code)}
                  onChange={() => toggleTag(tag.code)}
                />
                <span className={`px-2 py-0.5 rounded-full border ${TONE_STYLES[tag.tone]}`}>
                  {tag.nameEn} / {tag.nameZh}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="border border-[#e8e8e6] rounded-[10px] p-3 space-y-3">
          <legend className="px-1 text-[11px] font-bold text-slate-600">商品图片 / Product images</legend>
          <div className="text-[10px] text-slate-500">
            本地 Mock 图片库；刷新后修改可能丢失。商品主图 + 多张展示图。
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DEMO_IMAGE_LIBRARY.map(image => {
              const primary = form.primaryImage === image.url;
              const selected = form.galleryImages.includes(image.url);
              return (
                <div
                  key={image.key}
                  className={`rounded-[9px] border p-1.5 ${primary ? 'border-[#ff681e] bg-[#fff7f2]' : 'border-[#e8e8e6]'}`}
                >
                  <img
                    src={image.url}
                    alt={image.labelEn}
                    className="w-full aspect-[4/3] object-cover rounded-[6px]"
                    loading="lazy"
                  />
                  <div className="flex items-center justify-between gap-1 mt-1">
                    <button
                      type="button"
                      onClick={() => choosePrimary(image.url)}
                      className={`text-[9px] font-bold ${primary ? 'text-[#dd4a00]' : 'text-slate-500'}`}
                    >
                      {primary ? '主图' : '设为主图'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleGallery(image.url)}
                      className="text-[9px] font-bold text-slate-500"
                    >
                      {selected ? '移除' : '加入图库'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] font-semibold text-slate-600">展示图顺序</div>
          <div className="space-y-1">
            {form.galleryImages.map((url, index) => {
              const image = DEMO_IMAGE_LIBRARY.find(item => item.url === url);
              return (
                <div key={url} className="flex items-center gap-2 rounded-[8px] border border-[#eee] p-1.5">
                  <img src={url} alt="" className="w-10 h-10 rounded-[5px] object-cover" />
                  <span className="text-[10px] flex-1 truncate">
                    {index + 1}. {image?.labelEn ?? 'Demo image'}
                    {form.primaryImage === url ? ' · 主图' : ''}
                  </span>
                  <button type="button" onClick={() => moveGallery(index, -1)} aria-label="Move image up">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveGallery(index, 1)} aria-label="Move image down">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => toggleGallery(url)} aria-label="Remove image">
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  </button>
                </div>
              );
            })}
          </div>
        </fieldset>

        {error && (
          <div role="alert" className="p-2.5 rounded-[8px] bg-[#fff0ed] text-[#9d2f1f] text-xs font-semibold">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[42px] px-4 rounded-[9px] border border-[#e8e8e6] text-xs font-bold">
            取消
          </button>
          <button type="submit" className="min-h-[42px] px-5 rounded-[9px] bg-[#ff681e] text-white text-xs font-bold" data-testid="admin-save-product">
            保存商品
          </button>
        </div>
      </form>
    </div>
  );
};

const TaxonomyDialog: React.FC<{
  series: SeriesDefinition[];
  tags: FeatureTagDefinition[];
  onSaveSeries: (series: SeriesDefinition[]) => string | null;
  onSaveTags: (tags: FeatureTagDefinition[]) => string | null;
  onClose: () => void;
}> = ({ series, tags, onSaveSeries, onSaveTags, onClose }) => {
  const [tab, setTab] = useState<'series' | 'tags'>('series');
  const [seriesDraft, setSeriesDraft] = useState(series.map(item => ({ ...item })));
  const [tagDraft, setTagDraft] = useState(tags.map(item => ({ ...item })));
  const [error, setError] = useState('');

  const save = () => {
    const message = tab === 'series' ? onSaveSeries(seriesDraft) : onSaveTags(tagDraft);
    if (message) setError(message);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/45 backdrop-blur-[2px] flex items-stretch sm:items-center justify-center sm:p-4">
      <div className="w-full sm:max-w-4xl max-h-[100dvh] sm:max-h-[90dvh] overflow-y-auto bg-white sm:rounded-[16px] border border-[#e8e8e6] p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#151515]">系列与功能标签 / Series & tags</h2>
            <p className="text-[11px] text-slate-500 mt-1">稳定内部 ID/Code；显示名称可调整，供客户目录筛选。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close taxonomy editor" className="w-10 h-10 rounded-[9px] border border-[#e8e8e6] flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-[9px] bg-[#f5f5f3] p-1">
          <button type="button" onClick={() => setTab('series')} className={`h-9 rounded-[7px] text-xs font-bold ${tab === 'series' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>
            系列 / Series
          </button>
          <button type="button" onClick={() => setTab('tags')} className={`h-9 rounded-[7px] text-xs font-bold ${tab === 'tags' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>
            功能标签 / Tags
          </button>
        </div>
        {tab === 'series' ? (
          <div className="space-y-2">
            {seriesDraft.map((item, index) => (
              <div key={`${item.id}-${index}`} className="grid grid-cols-2 sm:grid-cols-6 gap-2 border border-[#eee] rounded-[9px] p-2">
                <input value={item.id} onChange={event => setSeriesDraft(prev => prev.map((entry, i) => i === index ? { ...entry, id: event.target.value.toLowerCase() } : entry))} placeholder="id" className="h-9 px-2 rounded-[6px] border font-mono text-[11px]" />
                <input value={item.nameZh} onChange={event => setSeriesDraft(prev => prev.map((entry, i) => i === index ? { ...entry, nameZh: event.target.value } : entry))} placeholder="中文名称" className="h-9 px-2 rounded-[6px] border text-[11px]" />
                <input value={item.nameEn} onChange={event => setSeriesDraft(prev => prev.map((entry, i) => i === index ? { ...entry, nameEn: event.target.value } : entry))} placeholder="English name" className="h-9 px-2 rounded-[6px] border text-[11px]" />
                <input type="number" min="1" value={item.order} onChange={event => setSeriesDraft(prev => prev.map((entry, i) => i === index ? { ...entry, order: Number(event.target.value) } : entry))} className="h-9 px-2 rounded-[6px] border text-[11px]" />
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={item.active} onChange={event => setSeriesDraft(prev => prev.map((entry, i) => i === index ? { ...entry, active: event.target.checked } : entry))} />启用</label>
              </div>
            ))}
            <button type="button" onClick={() => setSeriesDraft(prev => [...prev, { id: '', nameZh: '', nameEn: '', order: prev.length + 1, active: true }])} className="text-xs font-bold text-[#dd4a00]">+ 新增系列</button>
          </div>
        ) : (
          <div className="space-y-2">
            {tagDraft.map((item, index) => (
              <div key={`${item.code}-${index}`} className="grid grid-cols-2 sm:grid-cols-6 gap-2 border border-[#eee] rounded-[9px] p-2">
                <input value={item.code} onChange={event => setTagDraft(prev => prev.map((entry, i) => i === index ? { ...entry, code: event.target.value.toUpperCase() } : entry))} placeholder="CODE" className="h-9 px-2 rounded-[6px] border font-mono text-[11px]" />
                <input value={item.nameZh} onChange={event => setTagDraft(prev => prev.map((entry, i) => i === index ? { ...entry, nameZh: event.target.value } : entry))} placeholder="中文名称" className="h-9 px-2 rounded-[6px] border text-[11px]" />
                <input value={item.nameEn} onChange={event => setTagDraft(prev => prev.map((entry, i) => i === index ? { ...entry, nameEn: event.target.value } : entry))} placeholder="English name" className="h-9 px-2 rounded-[6px] border text-[11px]" />
                <select value={item.tone} onChange={event => setTagDraft(prev => prev.map((entry, i) => i === index ? { ...entry, tone: event.target.value as FeatureTagTone } : entry))} className="h-9 px-2 rounded-[6px] border text-[11px]">{TONES.map(tone => <option key={tone}>{tone}</option>)}</select>
                <input type="number" min="1" value={item.order} onChange={event => setTagDraft(prev => prev.map((entry, i) => i === index ? { ...entry, order: Number(event.target.value) } : entry))} className="h-9 px-2 rounded-[6px] border text-[11px]" />
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={item.active} onChange={event => setTagDraft(prev => prev.map((entry, i) => i === index ? { ...entry, active: event.target.checked } : entry))} />启用</label>
              </div>
            ))}
            <button type="button" onClick={() => setTagDraft(prev => [...prev, { code: '', nameZh: '', nameEn: '', tone: 'grey', order: prev.length + 1, active: true }])} className="text-xs font-bold text-[#dd4a00]">+ 新增标签</button>
          </div>
        )}
        {error && <div role="alert" className="p-2.5 rounded-[8px] bg-[#fff0ed] text-[#9d2f1f] text-xs font-semibold">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[42px] px-4 rounded-[9px] border border-[#e8e8e6] text-xs font-bold">取消</button>
          <button type="button" onClick={save} className="min-h-[42px] px-5 rounded-[9px] bg-[#171717] text-white text-xs font-bold" data-testid="admin-save-taxonomy">保存字典</button>
        </div>
      </div>
    </div>
  );
};
