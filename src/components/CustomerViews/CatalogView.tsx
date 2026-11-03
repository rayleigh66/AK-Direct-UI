/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Product, ProductSKU } from '../../types';
import { useApp } from '../../context/AppContext';
import {
  calculateSKUAvailableStock,
  calculateEffectiveUnitPrice,
  SKU_MOQ,
} from '../../utils/rules';
import {
  customerVisibleSkus,
  isProductAuthorizedForCompany,
} from '../../utils/catalogVisibility';
import {
  customerBrandName,
  customerCategory,
  customerProductTitle,
  customerSkuColor,
  customerTierName,
} from '../../utils/customerDisplay';
import {
  Search,
  CheckCircle,
  BellRing,
  Sparkles,
  Lock,
  ArrowRight,
  ShieldAlert,
  Store,
  Layers,
  TrendingUp,
  PackageCheck,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';

export const CatalogView: React.FC = () => {
  const {
    products,
    series,
    featureTags,
    inventory,
    promotions,
    currentCompany,
    brandGrants,
    brands,
    currentCompanyTierInfo,
    cart,
    addToCart,
    submitRestockRequest,
    setActiveTab,
    openDrawer,
    addToast,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [selectedBrandCode, setSelectedBrandCode] = useState<string>('AOKING');
  const [selectedSeries, setSelectedSeries] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Detail Modal & Restock Modal states
  const [restockSku, setRestockSku] = useState<{ product: Product; sku: ProductSKU } | null>(null);
  const [restockQty, setRestockQty] = useState<number>(50);
  const [restockSuccessMsg, setRestockSuccessMsg] = useState<string>('');

  const tierDiscount = currentCompanyTierInfo?.currentTier.discount_rate ?? 0;

  // Selected brand object
  const activeBrand = brands.find(b => b.code === selectedBrandCode) || brands[0];

  // Brand permission check (PRD D03 & T02)
  const isBrandAuthorized = useMemo(() => {
    if (!currentCompany) return false;
    return brandGrants.some(
      g => g.company_id === currentCompany.id && g.brand_id === activeBrand.id
    );
  }, [currentCompany, brandGrants, activeBrand]);

  // Filter products by brand and search/category
  const activeSeries = useMemo(
    () => series.filter(item => item.active).sort((a, b) => a.order - b.order),
    [series]
  );
  const activeTags = useMemo(
    () => featureTags.filter(tag => tag.active).sort((a, b) => a.order - b.order),
    [featureTags]
  );
  const tagLabel = (code: string) => featureTags.find(tag => tag.code === code)?.nameEn ?? code;
  const tagColor = (code: string) =>
    ({
      orange: '#ff681e',
      blue: '#2f6fed',
      sky: '#1c8199',
      green: '#198364',
      grey: '#777',
      purple: '#7048b5',
    })[featureTags.find(tag => tag.code === code)?.tone ?? 'grey'];

  const filteredProducts = useMemo(() => {
    if (!isBrandAuthorized) return [];

    return products.filter(p => {
      if (p.brand_id !== activeBrand.id || p.active === false) return false;
      const activeSkuList = p.skus.filter(sku => sku.sellable_status === 'active');
      if (!activeSkuList.length) return false;

      if (selectedCategory !== 'all' && p.category !== selectedCategory) {
        return false;
      }
      if (selectedSeries !== 'all' && p.series_id !== selectedSeries) {
        return false;
      }
      if (
        selectedTags.length > 0 &&
        !selectedTags.every(code => (p.tag_codes ?? []).includes(code))
      ) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle =
          customerProductTitle(p).toLowerCase().includes(q) ||
          p.title.toLowerCase().includes(q);
        const matchesCode = p.product_code.toLowerCase().includes(q);
        const matchesSku = p.skus.some(
          s =>
            s.sku_code.toLowerCase().includes(q) ||
            customerSkuColor(s).toLowerCase().includes(q) ||
            s.color_name.toLowerCase().includes(q)
        );
        if (!matchesTitle && !matchesCode && !matchesSku) return false;
      }

      if (inStockOnly) {
        const hasStock = activeSkuList.some(s => {
          const { totalAvailable } = calculateSKUAvailableStock(s.id, inventory);
          return totalAvailable >= SKU_MOQ;
        });
        if (!hasStock) return false;
      }

      return true;
    });
  }, [
    products,
    activeBrand,
    isBrandAuthorized,
    selectedCategory,
    selectedSeries,
    selectedTags,
    searchQuery,
    inStockOnly,
    inventory,
  ]);

  const categories = [
    { id: 'all', label: 'All in-stock' },
    { id: 'Business Backpacks', label: 'Business Backpacks' },
    { id: 'Travel Luggage', label: 'Travel Luggage' },
    { id: 'Urban Commuter', label: 'Urban Commuter' },
    { id: 'Executive Briefcases', label: 'Executive Briefcases' },
  ];

  // Statistics are scoped to the current company's authorised, listed catalogue.
  const authorizedProducts = useMemo(
    () =>
      products.filter(
        product =>
          product.active !== false &&
          isProductAuthorizedForCompany(product, currentCompany?.id, brandGrants)
      ),
    [products, currentCompany, brandGrants]
  );
  const authorizedActiveSkus = useMemo(
    () => authorizedProducts.flatMap(product => customerVisibleSkus(product)),
    [authorizedProducts]
  );

  const totalAvailableStockUnits = useMemo(() => {
    return authorizedActiveSkus.reduce((sum, sku) => {
      const { totalAvailable } = calculateSKUAvailableStock(sku.id, inventory);
      return sum + totalAvailable;
    }, 0);
  }, [authorizedActiveSkus, inventory]);

  const lowOrOutCount = useMemo(() => {
    return authorizedActiveSkus.reduce((count, sku) => {
      const { totalAvailable } = calculateSKUAvailableStock(sku.id, inventory);
      return totalAvailable < SKU_MOQ ? count + 1 : count;
    }, 0);
  }, [authorizedActiveSkus, inventory]);

  const handleQuickAdd = (sku: ProductSKU, e: React.MouseEvent) => {
    e.stopPropagation();
    const existing = cart.find(item => item.sku_id === sku.id)?.quantity ?? 0;
    const { totalAvailable } = calculateSKUAvailableStock(sku.id, inventory);
    const nextQuantity = existing + SKU_MOQ;
    if (nextQuantity > totalAvailable) {
      addToast(
        `Only ${totalAvailable} PCS available. Your existing ${existing} PCS were kept.`,
        'warn'
      );
      return;
    }
    const res = addToCart(sku.id, nextQuantity);
    if (res.success) {
      addToast(`10 PCS added. ${nextQuantity} PCS of ${sku.sku_code} now in your order list.`);
    } else {
      addToast(res.message ?? 'Could not add this SKU.', 'warn');
    }
  };

  const handleConfirmRestock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockSku) return;
    const res = submitRestockRequest(restockSku.sku.id, restockQty);
    if (res.success) {
      setRestockSuccessMsg('Restock request submitted.');
      addToast(`Restock request recorded for ${restockSku.sku.sku_code}`);
      setTimeout(() => {
        setRestockSuccessMsg('');
        setRestockSku(null);
      }, 1500);
    }
  };

  // Sparkline generator matching FactoryOS
  const renderSparkline = (vals: number[], color = '#ff681e') => {
    const mx = Math.max(...vals);
    const mn = Math.min(...vals);
    const pts = vals
      .map((v, i) => `${(i / (vals.length - 1) * 81).toFixed(1)},${(26 - ((v - mn) / (mx - mn || 1)) * 21).toFixed(1)}`)
      .join(' ');
    return (
      <svg className="absolute right-5 bottom-4 w-20 h-7 opacity-90" viewBox="0 0 81 28">
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div className="flex flex-col gap-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-20">
      {/* FactoryOS Eyebrow + Page Head */}
      <div className="order-1 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold text-[#8f9191] tracking-[1.7px] uppercase">
            <span className="w-4 h-[2px] bg-[#ff681e]" />
            <span>B2B CATALOG / SPOT WHOLESALE</span>
          </div>
          <h1 className="text-2xl sm:text-[31px] font-extrabold text-[#151515] tracking-tight mt-1 mb-1 leading-tight">
            Shop in-stock wholesale
          </h1>
          <p className="text-xs text-[#8c8e8e] leading-relaxed">
            Browse by SKU, compare available stock across warehouses, and meet the 10 PCS MOQ per
            colour. Prices are in USD.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2.5">
          <button
            onClick={() => setActiveTab('cart')}
            className="min-h-[44px] border border-[#e8e8e6] bg-white text-[#343434] text-xs font-semibold px-4 py-2.5 rounded-[9px] hover:border-[#ccc] transition-all flex items-center justify-center gap-2 shadow-2xs whitespace-nowrap shrink-0"
          >
            <span>View order list</span>
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className="min-h-[44px] bg-[#ff681e] text-white border border-[#ff681e] text-xs font-semibold px-4 py-2.5 rounded-[9px] hover:bg-[#ed5610] transition-all flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(255,104,30,0.2)] whitespace-nowrap shrink-0"
          >
            <span>My orders</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* FactoryOS Hero Card */}
      <div className="order-3 lg:order-2 relative min-h-[170px] sm:min-h-[206px] py-6 sm:py-0 flex items-center justify-between bg-[#1b1b1b] rounded-[17px] text-white overflow-hidden px-6 sm:px-10 shadow-[0_8px_32px_rgba(15,15,15,0.035)]">
        {/* Background Radial Rings */}
        <div className="absolute -right-10 -top-32 w-[440px] h-[440px] rounded-full border border-white/10 pointer-events-none shadow-[0_0_0_43px_rgba(255,255,255,0.03),0_0_0_85px_rgba(255,255,255,0.02),0_0_0_125px_rgba(255,255,255,0.015)]" />
        
        <div className="relative z-10 max-w-xl space-y-2">
          <div className="flex items-center gap-2 text-[10px] tracking-[2px] font-bold text-[#a9aaa9] uppercase">
            <i className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff681e]" />
            <span>AOKING B2B DIRECT · V0.3 SPECIFICATION</span>
          </div>
          <h2 className="text-xl sm:text-[28px] font-extrabold tracking-tight leading-snug m-0">
            Precise stock. <b>Human-approved reservations.</b>
          </h2>
          <p className="text-xs text-[#aaa] leading-relaxed max-w-lg">
            Your order request does not lock stock. A sales representative reviews quantity and
            availability before creating a 72-hour demo reservation. No phone, email or street
            address is collected.
          </p>
        </div>

        <div className="relative z-10 hidden sm:flex items-end gap-4">
          <div className="text-[76px] lg:text-[88px] font-black tracking-[-8px] text-white/5 font-mono select-none">
            AK
          </div>
          <button
            onClick={() => setActiveTab('cart')}
            className="w-11 h-11 rounded-[13px] bg-[#ff681e] hover:bg-[#ed5610] text-white flex items-center justify-center transition-transform hover:-translate-y-0.5 shadow-[0_4px_16px_rgba(255,104,30,0.3)] shrink-0"
            aria-label="View order list"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 4-Metric Grid (FactoryOS .metric-grid) */}
      <div className="order-4 lg:order-3 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-4 sm:p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[112px] sm:min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>Active SKUs</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <Store className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#151515] mt-3 mb-1 font-mono leading-none">
            {authorizedActiveSkus.length} <small className="text-xs font-normal text-[#999]">SKUs</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#198364] font-bold">100%</b> factory-direct stock
          </div>
          {renderSparkline([10, 14, 12, 16, 18, 17, 21], '#ff681e')}
        </div>

        {/* Metric 2 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-4 sm:p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[112px] sm:min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>Available across warehouses</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <Layers className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#151515] mt-3 mb-1 font-mono leading-none">
            {totalAvailableStockUnits.toLocaleString()} <small className="text-xs font-normal text-[#999]">PCS</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#198364] font-bold">● Live</b> Shanghai / Guangzhou / Ningbo
          </div>
          {renderSparkline([1200, 1340, 1280, 1450, 1500, 1560, 1620], '#198364')}
        </div>

        {/* Metric 3 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-4 sm:p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[112px] sm:min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>Low or out of stock</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <BellRing className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#dd4a00] mt-3 mb-1 font-mono leading-none">
            {lowOrOutCount.toString().padStart(2, '0')} <small className="text-xs font-normal text-[#999]">SKUs</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#dd4a00] font-bold">●</b> Restock requests accepted
          </div>
          {renderSparkline([4, 5, 4, 3, 4, 3, 2], '#dd4a00')}
        </div>

        {/* Metric 4 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-4 sm:p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[112px] sm:min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>Current partner discount</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#151515] mt-3 mb-1 font-mono leading-none">
            -{(tierDiscount * 100).toFixed(0)}% <small className="text-xs font-normal text-[#999]">OFF</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#198364] font-bold">{customerTierName(currentCompanyTierInfo?.currentTier)}</b>
          </div>
          {renderSparkline([5, 5, 10, 10, 10, 10, 10], '#ff681e')}
        </div>
      </div>

      {/* Brand Tabs Bar + Client Context (PRD D03 & T02) */}
      <div className="order-5 lg:order-4 bg-white p-3.5 sm:p-4 rounded-[17px] border border-[#eaeae7] shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-bold text-[#888]">Authorized brands:</div>
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#f5f5f4] rounded-[10px]">
            {brands.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBrandCode(b.code)}
                className={`px-3 py-1.5 text-xs font-bold rounded-[8px] transition-all whitespace-nowrap ${
                  selectedBrandCode === b.code
                    ? 'bg-white text-[#151515] shadow-xs'
                    : 'text-[#696b6c] hover:text-[#151515]'
                }`}
              >
                {customerBrandName(b)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#666]">
          <span>Company: <strong className="text-[#151515]">{currentCompany?.short_name}</strong></span>
          <span className="text-[#ccc]">·</span>
          <span>Code: <strong className="font-mono text-[#151515]">{currentCompany?.customer_code}</strong></span>
          <span className="text-[#ccc]">·</span>
          <span className="font-bold text-[#198364]">
            {customerTierName(currentCompanyTierInfo?.currentTier)}
          </span>
        </div>
      </div>

      {/* Mobile-first ordering: search, filters and products appear before the dashboard panels. */}
      <div className="order-2 lg:order-5 space-y-4">
      {!isBrandAuthorized ? (
        <div className="p-8 bg-white rounded-[17px] border border-[#ffeadb] text-center space-y-4 max-w-xl mx-auto shadow-sm">
          <div className="w-12 h-12 rounded-[14px] bg-[#fff0ed] text-[#d34f36] flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#151515]">Brand authorization required</h3>
            <p className="text-xs text-[#858789] mt-1.5 max-w-md mx-auto leading-relaxed">
              Your company (
              <span className="font-semibold text-[#151515]">{currentCompany?.customer_code}</span>
              ) is not authorized to distribute <strong className="text-[#d34f36]">{customerBrandName(activeBrand)}</strong>.
              Stock and wholesale pricing remain isolated until an administrator grants access.
            </p>
          </div>
          <button
            onClick={() => setSelectedBrandCode('AOKING')}
            className="px-4 py-2 bg-[#171717] text-white text-xs font-bold rounded-[9px] hover:bg-black transition-colors"
          >
            Return to authorized AOKING catalog
          </button>
        </div>
      ) : (
        <>
          {/* Search Bar & Filter Tabs */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Field Search */}
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search products or SKU..."
                  className="w-full h-[41px] pl-10 pr-4 rounded-[9px] border border-[#e8e8e6] bg-white text-xs text-[#151515] outline-none focus:border-[#ff9e6c] transition-colors"
                />
                <Search className="w-4 h-4 text-[#999] absolute left-3.5 top-3" />
              </div>

              {/* In-Stock Toggle */}
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#666] select-none py-1">
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={e => setInStockOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-[#e8e8e6] accent-[#ff681e]"
                />
                <span>In stock ≥ 10 PCS only</span>
              </label>
            </div>

            {/* Series Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" data-testid="series-filters">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#999]">Series</span>
              <button
                onClick={() => setSelectedSeries('all')}
                className={`min-h-[38px] px-3 py-1.5 text-[11px] font-bold rounded-[8px] whitespace-nowrap ${
                  selectedSeries === 'all'
                    ? 'bg-[#171717] text-white'
                    : 'bg-white border border-[#e8e8e6] text-[#696b6c]'
                }`}
              >
                All series
              </button>
              {activeSeries.map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedSeries(item.id)}
                  className={`min-h-[38px] px-3 py-1.5 text-[11px] font-bold rounded-[8px] whitespace-nowrap ${
                    selectedSeries === item.id
                      ? 'bg-[#171717] text-white'
                      : 'bg-white border border-[#e8e8e6] text-[#696b6c]'
                  }`}
                >
                  {item.nameEn}
                </button>
              ))}
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {categories.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`min-h-[44px] px-4 py-2 text-xs font-bold rounded-[9px] whitespace-nowrap transition-all ${
                    selectedCategory === c.id
                      ? 'bg-[#171717] text-white shadow-xs'
                      : 'bg-white border border-[#e8e8e6] text-[#696b6c] hover:text-[#1f1f1f] hover:border-[#ccc]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Feature Tag Filters */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" data-testid="tag-filters">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#999]">Tags</span>
              {activeTags.map(tag => {
                const selected = selectedTags.includes(tag.code);
                return (
                  <button
                    key={tag.code}
                    onClick={() =>
                      setSelectedTags(prev =>
                        prev.includes(tag.code)
                          ? prev.filter(code => code !== tag.code)
                          : [...prev, tag.code]
                      )
                    }
                    aria-pressed={selected}
                    className="min-h-[34px] px-2.5 py-1 rounded-full border text-[10px] font-semibold whitespace-nowrap"
                    style={{
                      borderColor: selected ? tagColor(tag.code) : '#e8e8e6',
                      background: selected ? `${tagColor(tag.code)}14` : '#fff',
                      color: selected ? tagColor(tag.code) : '#696b6c',
                    }}
                  >
                    {tag.nameEn}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredProducts.map(product => {
              const productSkus = product.skus.filter(sku => sku.sellable_status === 'active');
              const primarySku = productSkus[0];
              const { totalAvailable } = calculateSKUAvailableStock(primarySku.id, inventory);
              const priceInfo = calculateEffectiveUnitPrice(
                primarySku.base_price_usd,
                primarySku.id,
                tierDiscount,
                promotions
              );

              return (
                <div
                  key={product.id}
                  onClick={() => openDrawer('sku', primarySku.id)}
                  data-testid="product-card"
                  className="group bg-white rounded-[17px] border border-[#eaeae7] overflow-hidden hover:shadow-[0_9px_22px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col cursor-pointer"
                >
                  {/* Lead with Imagery (65-75% height) */}
                  <div className="relative aspect-[4/3] bg-[#f8f8f6] overflow-hidden border-b border-[#f0f0ef]">
                    <img
                      src={product.primary_image}
                      alt={customerProductTitle(product)}
                      className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                      width={1000}
                      height={746}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />

                    {priceInfo.isPromo && (
                      <div className="absolute top-3 left-3 bg-[#ff681e] text-white text-[10px] font-bold px-2 py-0.5 rounded-[5px] shadow-sm flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span>Limited offer</span>
                      </div>
                    )}
                  </div>

                  {/* Content Area */}
                  <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      {/* Unboxed Metadata Header */}
                      <div className="flex items-center gap-1.5 text-[10px] text-[#8f9191] font-bold uppercase tracking-wider mb-1">
                        <span>{product.product_code}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{customerCategory(product.category)}</span>
                      </div>

                      <h3 className="text-sm font-bold text-[#151515] line-clamp-2 leading-snug min-h-[2.5rem] group-hover:text-[#ff681e] transition-colors">
                        {customerProductTitle(product)}
                      </h3>

                      {/* SKU Color Swatches */}
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <span className="text-[10px] text-[#aaa]">Colours:</span>
                        <div className="flex items-center gap-1">
                          {productSkus.map(s => {
                            const sStock = calculateSKUAvailableStock(s.id, inventory).totalAvailable;
                            return (
                              <span
                                key={s.id}
                                title={`${customerSkuColor(s)} (${sStock} PCS available)`}
                                className={`w-3.5 h-3.5 rounded-full border ${
                                  sStock >= SKU_MOQ ? 'border-black/30' : 'border-[#d34f36] ring-1 ring-[#d34f36]/40'
                                }`}
                                style={{ backgroundColor: s.color_hex }}
                              />
                            );
                          })}
                        </div>
                      </div>
                      {(product.tag_codes ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(product.tag_codes ?? []).slice(0, 3).map(code => (
                            <span
                              key={code}
                              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border"
                              style={{
                                color: tagColor(code),
                                borderColor: `${tagColor(code)}40`,
                                background: `${tagColor(code)}0f`,
                              }}
                            >
                              {tagLabel(code)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Footer: Price & Stock Actions */}
                    <div className="pt-3 border-t border-[#f0f0ef] flex items-end justify-between">
                      <div>
                        <div className="text-[10px] text-[#999]">Reference wholesale (USD)</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-base font-bold font-mono text-[#151515] tabular-nums">
                            ${priceInfo.effectivePrice.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-[#999]">/PCS</span>
                        </div>
                        <div className="text-[10px] text-[#aaa] font-mono">
                          List ${primarySku.base_price_usd.toFixed(2)}
                        </div>
                      </div>

                      <div className="text-right">
                        <div
                          className={`text-[11px] font-bold font-mono tabular-nums ${
                            totalAvailable >= SKU_MOQ
                              ? 'text-[#198364]'
                              : totalAvailable > 0
                              ? 'text-[#aa750e]'
                              : 'text-[#d34f36]'
                          }`}
                        >
                          {totalAvailable >= SKU_MOQ
                            ? `${totalAvailable} PCS available`
                            : totalAvailable > 0
                            ? `Only ${totalAvailable} PCS (< MOQ)`
                            : 'Sold out (0 PCS)'}
                        </div>

                        {totalAvailable >= SKU_MOQ ? (
                          <button
                            onClick={e => handleQuickAdd(primarySku, e)}
                            data-testid="quick-add"
                            className="mt-1 px-3 py-1.5 bg-[#171717] text-white rounded-[7px] text-xs font-bold hover:bg-[#ff681e] transition-colors"
                          >
                            +10 PCS
                          </button>
                        ) : (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setRestockSku({ product, sku: primarySku });
                            }}
                            className="mt-1 px-2.5 py-1.5 bg-[#fff1e8] text-[#ff681e] rounded-[7px] text-xs font-bold hover:bg-[#ffdacf] transition-colors flex items-center gap-1"
                          >
                            <BellRing className="w-3 h-3" />
                            <span>Request restock</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredProducts.length === 0 && (
            <div className="p-12 text-center bg-white rounded-[17px] border border-[#eaeae7]">
              <div className="text-sm font-bold text-[#151515]">No in-stock products match</div>
              <p className="text-xs text-[#aaa] mt-1">Try another search or change the category filter.</p>
            </div>
          )}
        </>
      )}
      </div>

      {/* Restock Request Modal (PRD D08, D09, T06) */}
      {restockSku && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101010]/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-[16px] shadow-[0_25px_85px_rgba(0,0,0,0.2)] border border-[#eaeae7]">
            <div className="p-5 bg-[#171717] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BellRing className="w-5 h-5 text-[#ff843f]" />
                <h3 className="text-sm font-bold">Request restock</h3>
              </div>
              <button
                onClick={() => setRestockSku(null)}
                className="text-[#999] hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmRestock} className="p-5 space-y-4">
              <div className="p-3 bg-[#f8f8f6] rounded-[10px] text-xs space-y-1">
                <div>Product: <strong className="text-[#151515]">{customerProductTitle(restockSku.product)}</strong></div>
                <div>SKU: <span className="font-mono">{restockSku.sku.sku_code}</span> ({customerSkuColor(restockSku.sku)})</div>
                <div>Currently available: <strong className="text-[#d34f36]">
                  {calculateSKUAvailableStock(restockSku.sku.id, inventory).totalAvailable} PCS
                </strong></div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#707273] mb-1">
                  Requested quantity (PCS)
                </label>
                <input
                  type="number"
                  min={SKU_MOQ}
                  value={restockQty}
                  onChange={e => setRestockQty(parseInt(e.target.value) || SKU_MOQ)}
                  className="w-full h-11 px-3 rounded-[9px] border border-[#e7e7e4] font-mono text-sm outline-none focus:border-[#ff955b]"
                  required
                />
              </div>

              <div className="p-3.5 bg-[#fff7e5] rounded-[10px] text-[11px] text-[#aa750e] leading-relaxed flex items-start gap-2 border border-[#ffe9d9]">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#aa750e]" />
                <div>
                  <strong>How restock requests work:</strong> your request is sent to the assigned
                  sales representative. When available stock reaches the 10 PCS MOQ, the demo
                  account receives a notification. <em>A restock notification does not reserve stock.</em>
                </div>
              </div>

              {restockSuccessMsg && (
                <div className="p-2.5 bg-[#eaf7f0] text-[#198364] text-xs rounded-[9px] flex items-center gap-1.5 font-bold">
                  <CheckCircle className="w-4 h-4 text-[#198364]" />
                  <span>{restockSuccessMsg}</span>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRestockSku(null)}
                  className="flex-1 h-11 rounded-[9px] border border-[#e8e8e6] text-[#343434] text-xs font-bold hover:bg-[#f6f6f4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-[9px] bg-[#ff681e] text-white text-xs font-bold hover:bg-[#ed5610] shadow-[0_4px_12px_rgba(255,104,30,0.2)]"
                >
                  Submit request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
