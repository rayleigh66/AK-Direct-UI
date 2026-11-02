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
import { ProductDetailModal } from './ProductDetailModal';
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
    inventory,
    promotions,
    currentCompany,
    brandGrants,
    brands,
    currentCompanyTierInfo,
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

  // Detail Modal & Restock Modal states
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
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
  const filteredProducts = useMemo(() => {
    if (!isBrandAuthorized) return [];

    return products.filter(p => {
      if (p.brand_id !== activeBrand.id) return false;

      if (selectedCategory !== 'all' && p.category !== selectedCategory) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = p.title.toLowerCase().includes(q);
        const matchesCode = p.product_code.toLowerCase().includes(q);
        const matchesSku = p.skus.some(s => s.sku_code.toLowerCase().includes(q));
        if (!matchesTitle && !matchesCode && !matchesSku) return false;
      }

      if (inStockOnly) {
        const hasStock = p.skus.some(s => {
          const { totalAvailable } = calculateSKUAvailableStock(s.id, inventory);
          return totalAvailable >= SKU_MOQ;
        });
        if (!hasStock) return false;
      }

      return true;
    });
  }, [products, activeBrand, isBrandAuthorized, selectedCategory, searchQuery, inStockOnly, inventory]);

  const categories = [
    { id: 'all', label: '全部现货' },
    { id: 'Business Backpacks', label: '商务双肩包' },
    { id: 'Travel Luggage', label: '登机拉杆箱' },
    { id: 'Urban Commuter', label: '城市机能包' },
    { id: 'Executive Briefcases', label: '真皮公文包' },
  ];

  // Compute metrics for the top cards
  const totalAvailableStockUnits = useMemo(() => {
    return products.reduce((sum, p) => {
      return (
        sum +
        p.skus.reduce((skuSum, s) => {
          const { totalAvailable } = calculateSKUAvailableStock(s.id, inventory);
          return skuSum + totalAvailable;
        }, 0)
      );
    }, 0);
  }, [products, inventory]);

  const lowOrOutCount = useMemo(() => {
    let count = 0;
    products.forEach(p => {
      p.skus.forEach(s => {
        const { totalAvailable } = calculateSKUAvailableStock(s.id, inventory);
        if (totalAvailable < SKU_MOQ) count++;
      });
    });
    return count;
  }, [products, inventory]);

  const handleQuickAdd = (sku: ProductSKU, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = addToCart(sku.id, SKU_MOQ);
    if (res.success) {
      addToast(`已添加 10 PCS (${sku.sku_code}) 至订购清单`);
    } else {
      alert(res.message);
    }
  };

  const handleConfirmRestock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockSku) return;
    const res = submitRestockRequest(restockSku.sku.id, restockQty);
    if (res.success) {
      setRestockSuccessMsg(res.message || '补货申请已提交！');
      addToast(`补货需求已登记 (${restockSku.sku.sku_code})，待到货通知`);
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
    <div className="space-y-6 pb-20">
      {/* FactoryOS Eyebrow + Page Head */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold text-[#8f9191] tracking-[1.7px] uppercase">
            <span className="w-4 h-[2px] bg-[#ff681e]" />
            <span>B2B CATALOG / SPOT WHOLESALE</span>
          </div>
          <h1 className="text-2xl sm:text-[31px] font-extrabold text-[#151515] tracking-tight mt-1 mb-1 leading-tight">
            现货选款与订购申请
          </h1>
          <p className="text-xs text-[#8c8e8e] leading-relaxed">
            按 SKU 查看多仓实时汇总可订库存 · 独立满足起订量 10 PCS · USD 参考批发价
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveTab('cart')}
            className="border border-[#e8e8e6] bg-white text-[#343434] text-xs font-semibold px-4 py-2.5 rounded-[9px] hover:border-[#ccc] transition-all flex items-center gap-2 shadow-2xs"
          >
            <span>查看订购清单</span>
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className="bg-[#ff681e] text-white border border-[#ff681e] text-xs font-semibold px-4 py-2.5 rounded-[9px] hover:bg-[#ed5610] transition-all flex items-center gap-1.5 shadow-[0_4px_12px_rgba(255,104,30,0.2)]"
          >
            <span>我的订单进度</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* FactoryOS Hero Card */}
      <div className="relative h-[190px] sm:h-[206px] flex items-center justify-between bg-[#1b1b1b] rounded-[17px] text-white overflow-hidden px-6 sm:px-10 shadow-[0_8px_32px_rgba(15,15,15,0.035)]">
        {/* Background Radial Rings */}
        <div className="absolute -right-10 -top-32 w-[440px] h-[440px] rounded-full border border-white/10 pointer-events-none shadow-[0_0_0_43px_rgba(255,255,255,0.03),0_0_0_85px_rgba(255,255,255,0.02),0_0_0_125px_rgba(255,255,255,0.015)]" />
        
        <div className="relative z-10 max-w-xl space-y-2">
          <div className="flex items-center gap-2 text-[10px] tracking-[2px] font-bold text-[#a9aaa9] uppercase">
            <i className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff681e]" />
            <span>AOKING B2B DIRECT · V0.3 SPECIFICATION</span>
          </div>
          <h2 className="text-xl sm:text-[28px] font-extrabold tracking-tight leading-snug m-0">
            现货精确可订，<b>人工核准锁库。</b>
          </h2>
          <p className="text-xs text-[#aaa] leading-relaxed">
            在线提交为【订购申请】；业务员核对库存与交期后整单模拟预占 72 小时（Demo，非数据库事务）。严格不采集客户个人联系方式与地址。
          </p>
        </div>

        <div className="relative z-10 hidden sm:flex items-end gap-4">
          <div className="text-[76px] lg:text-[88px] font-black tracking-[-8px] text-white/5 font-mono select-none">
            AK
          </div>
          <button
            onClick={() => setActiveTab('cart')}
            className="w-11 h-11 rounded-[13px] bg-[#ff681e] hover:bg-[#ed5610] text-white flex items-center justify-center transition-transform hover:-translate-y-0.5 shadow-[0_4px_16px_rgba(255,104,30,0.3)] shrink-0"
            title="去订购清单"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 4-Metric Grid (FactoryOS .metric-grid) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>当前在售现货 SKU</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <Store className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#151515] mt-3 mb-1 font-mono leading-none">
            {products.flatMap(p => p.skus).length} <small className="text-xs font-normal text-[#999]">款</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#198364] font-bold">100%</b> 厂线正品保障
          </div>
          {renderSparkline([10, 14, 12, 16, 18, 17, 21], '#ff681e')}
        </div>

        {/* Metric 2 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>多仓总可订现货</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <Layers className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#151515] mt-3 mb-1 font-mono leading-none">
            {totalAvailableStockUnits.toLocaleString()} <small className="text-xs font-normal text-[#999]">PCS</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#198364] font-bold">● 实时</b> 上海/广州/宁波多仓
          </div>
          {renderSparkline([1200, 1340, 1280, 1450, 1500, 1560, 1620], '#198364')}
        </div>

        {/* Metric 3 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>缺货与待补货款式</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <BellRing className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#dd4a00] mt-3 mb-1 font-mono leading-none">
            {lowOrOutCount.toString().padStart(2, '0')} <small className="text-xs font-normal text-[#999]">款</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#dd4a00] font-bold">●</b> 支持提交 Restock 需求
          </div>
          {renderSparkline([4, 5, 4, 3, 4, 3, 2], '#dd4a00')}
        </div>

        {/* Metric 4 */}
        <div className="bg-white border border-[#eaeae7] rounded-[17px] p-5 relative overflow-hidden shadow-[0_8px_32px_rgba(15,15,15,0.035)] min-h-[142px]">
          <div className="flex justify-between items-center text-xs text-[#929393]">
            <span>当前伙伴等级折扣</span>
            <span className="w-8 h-8 rounded-[9px] bg-[#f7f7f6] flex items-center justify-center text-[#666]">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="text-[28px] sm:text-[32px] font-extrabold tracking-tight text-[#151515] mt-3 mb-1 font-mono leading-none">
            -{(tierDiscount * 100).toFixed(0)}% <small className="text-xs font-normal text-[#999]">OFF</small>
          </div>
          <div className="text-[10px] text-[#aaa] mt-2">
            <b className="text-[#198364] font-bold">{currentCompanyTierInfo?.currentTier.name}</b>
          </div>
          {renderSparkline([5, 5, 10, 10, 10, 10, 10], '#ff681e')}
        </div>
      </div>

      {/* Brand Tabs Bar + Client Context (PRD D03 & T02) */}
      <div className="bg-white p-4 rounded-[17px] border border-[#eaeae7] shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-bold text-[#888]">授权品牌:</div>
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
                {b.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#666]">
          <span>公司主体: <strong className="text-[#151515]">{currentCompany?.short_name}</strong></span>
          <span className="text-[#ccc]">·</span>
          <span>编号: <strong className="font-mono text-[#151515]">{currentCompany?.customer_code}</strong></span>
          <span className="text-[#ccc]">·</span>
          <span className="font-bold text-[#198364]">
            {currentCompanyTierInfo?.currentTier.name}
          </span>
        </div>
      </div>

      {/* Unauthorized Brand Guard (T02) */}
      {!isBrandAuthorized ? (
        <div className="p-8 bg-white rounded-[17px] border border-[#ffeadb] text-center space-y-4 max-w-xl mx-auto shadow-sm">
          <div className="w-12 h-12 rounded-[14px] bg-[#fff0ed] text-[#d34f36] flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#151515]">品牌访问受限 (Brand Authorization Required)</h3>
            <p className="text-xs text-[#858789] mt-1.5 max-w-md mx-auto leading-relaxed">
              根据 PRD D03 与验收标准 T02 规定：您的公司 (
              <span className="font-semibold text-[#151515]">{currentCompany?.customer_code}</span>
              ) 尚未获管理员授予 <strong className="text-[#d34f36]">{activeBrand.name}</strong> 的分销权。
              现货库存与商业批发价格已安全隔离保护。
            </p>
          </div>
          <button
            onClick={() => setSelectedBrandCode('AOKING')}
            className="px-4 py-2 bg-[#171717] text-white text-xs font-bold rounded-[9px] hover:bg-black transition-colors"
          >
            返回已授权品牌 (AOKING)
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
                  placeholder="搜索款号 (AK-9042)、商品名称或 SKU..."
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
                <span>仅看达起订量现货 (Available ≥ 10 PCS)</span>
              </label>
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
          </div>

          {/* Product Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map(product => {
              const primarySku = product.skus[0];
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
                  className="group bg-white rounded-[17px] border border-[#eaeae7] overflow-hidden hover:shadow-[0_9px_22px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col cursor-pointer"
                >
                  {/* Lead with Imagery (65-75% height) */}
                  <div className="relative aspect-[4/3] bg-[#f8f8f6] overflow-hidden border-b border-[#f0f0ef]">
                    <img
                      src={product.primary_image}
                      alt={product.title}
                      className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />

                    {priceInfo.isPromo && (
                      <div className="absolute top-3 left-3 bg-[#ff681e] text-white text-[10px] font-bold px-2 py-0.5 rounded-[5px] shadow-sm flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span>限时促销</span>
                      </div>
                    )}
                  </div>

                  {/* Content Area */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      {/* Unboxed Metadata Header */}
                      <div className="flex items-center gap-1.5 text-[10px] text-[#8f9191] font-bold uppercase tracking-wider mb-1">
                        <span>{product.product_code}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{product.category}</span>
                      </div>

                      <h3 className="text-sm font-bold text-[#151515] line-clamp-1 group-hover:text-[#ff681e] transition-colors">
                        {product.title}
                      </h3>

                      {/* SKU Color Swatches */}
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <span className="text-[10px] text-[#aaa]">配色:</span>
                        <div className="flex items-center gap-1">
                          {product.skus.map(s => {
                            const sStock = calculateSKUAvailableStock(s.id, inventory).totalAvailable;
                            return (
                              <span
                                key={s.id}
                                title={`${s.color_name} (可订: ${sStock} PCS)`}
                                className={`w-3.5 h-3.5 rounded-full border ${
                                  sStock >= SKU_MOQ ? 'border-black/30' : 'border-[#d34f36] ring-1 ring-[#d34f36]/40'
                                }`}
                                style={{ backgroundColor: s.color_hex }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Footer: Price & Stock Actions */}
                    <div className="pt-3 border-t border-[#f0f0ef] flex items-end justify-between">
                      <div>
                        <div className="text-[10px] text-[#999]">参考批发价 (USD)</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-base font-bold font-mono text-[#151515] tabular-nums">
                            ${priceInfo.effectivePrice.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-[#999]">/PCS</span>
                        </div>
                        <div className="text-[10px] text-[#aaa] font-mono">
                          原价 ${primarySku.base_price_usd.toFixed(2)}
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
                            ? `可订: ${totalAvailable} PCS`
                            : totalAvailable > 0
                            ? `仅剩 ${totalAvailable} (< MOQ)`
                            : '已售罄 (0 PCS)'}
                        </div>

                        {totalAvailable >= SKU_MOQ ? (
                          <button
                            onClick={e => handleQuickAdd(primarySku, e)}
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
                            <span>申请补货</span>
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
              <div className="text-sm font-bold text-[#151515]">未找到符合条件的现货商品</div>
              <p className="text-xs text-[#aaa] mt-1">请尝试清除搜索关键词或调整分类筛选条件</p>
            </div>
          )}
        </>
      )}

      {/* Restock Request Modal (PRD D08, D09, T06) */}
      {restockSku && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101010]/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-[16px] shadow-[0_25px_85px_rgba(0,0,0,0.2)] border border-[#eaeae7] overflow-hidden">
            <div className="p-5 bg-[#171717] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BellRing className="w-5 h-5 text-[#ff843f]" />
                <h3 className="text-sm font-bold">缺货补货需求登记 (Request Restock)</h3>
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
                <div>款号: <strong className="text-[#151515]">{restockSku.product.product_code}</strong></div>
                <div>SKU: <span className="font-mono">{restockSku.sku.sku_code}</span> ({restockSku.sku.color_name})</div>
                <div>当前多仓实无可订: <strong className="text-[#d34f36]">
                  {calculateSKUAvailableStock(restockSku.sku.id, inventory).totalAvailable} PCS
                </strong></div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#707273] mb-1">
                  期望补货数量 (PCS)
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
                  <strong>规则说明 (PRD D09):</strong> 补货需求将实时报送负责业务员内部邮箱。
                  待仓库现货可订量恢复达起订量 (≥10 PCS) 时，系统将自动向您发送到货通知。
                  <em>到货通知不自动预占锁定库存</em>。
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
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-[9px] bg-[#ff681e] text-white text-xs font-bold hover:bg-[#ed5610] shadow-[0_4px_12px_rgba(255,104,30,0.2)]"
                >
                  确认登记
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
