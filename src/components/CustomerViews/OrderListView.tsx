/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  calculateSKUAvailableStock,
  calculateEffectiveUnitPrice,
  checkPrivacyViolations,
  SKU_MOQ,
} from '../../utils/rules';
import {
  Trash2,
  Plus,
  Minus,
  AlertCircle,
  ShieldCheck,
  Plane,
  Truck,
  Ship,
  MapPin,
  Calendar,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { Order } from '../../types';

export const OrderListView: React.FC = () => {
  const {
    cart,
    products,
    inventory,
    promotions,
    currentCompanyTierInfo,
    currentCompany,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    submitOrder,
    setActiveTab,
  } = useApp();

  const [shippingMethod, setShippingMethod] = useState<Order['shipping_method']>('Sea');
  const [destinationCountry, setDestinationCountry] = useState<string>(
    currentCompany?.country_alpha3 || 'USA'
  );
  const [expectedDate, setExpectedDate] = useState<string>('2026-11-25');
  const [shippingRequirements, setShippingRequirements] = useState<string>(
    'Standard export master cartons with pallet stretch wrap. AOKING barcode labels required.'
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submittedOrderNo, setSubmittedOrderNo] = useState<string | null>(null);

  const tierDiscount = currentCompanyTierInfo?.currentTier.discount_rate ?? 0;

  // Real-time privacy check on requirements
  const privacyCheck = checkPrivacyViolations(shippingRequirements);

  // Map cart lines with SKU and product details
  const cartLinesDetailed = cart.map(item => {
    let skuObj = null;
    let prodObj = null;
    for (const p of products) {
      const s = p.skus.find(x => x.id === item.sku_id);
      if (s) {
        skuObj = s;
        prodObj = p;
        break;
      }
    }

    const { totalAvailable } = calculateSKUAvailableStock(item.sku_id, inventory);
    const priceInfo = skuObj
      ? calculateEffectiveUnitPrice(skuObj.base_price_usd, skuObj.id, tierDiscount, promotions)
      : { effectivePrice: 0, isPromo: false, originalPrice: 0, isStacked: false };

    return {
      skuId: item.sku_id,
      quantity: item.quantity,
      sku: skuObj,
      product: prodObj,
      availableStock: totalAvailable,
      unitPrice: priceInfo.effectivePrice,
      isPromo: priceInfo.isPromo,
      subtotal: priceInfo.effectivePrice * item.quantity,
    };
  });

  const totalAmountUsd = cartLinesDetailed.reduce((sum, item) => sum + item.subtotal, 0);
  const totalPcs = cartLinesDetailed.reduce((sum, item) => sum + item.quantity, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (cart.length === 0) {
      setErrorMessage('清单为空，无法提交');
      return;
    }

    if (privacyCheck.hasViolation) {
      setErrorMessage(privacyCheck.message || '隐私安全检查未通过');
      return;
    }

    setSubmitting(true);
    const res = submitOrder({
      shippingMethod,
      destinationCountryAlpha3: destinationCountry,
      expectedShipDate: expectedDate,
      shippingRequirements,
    });

    setSubmitting(false);
    if (res.success) {
      setSubmittedOrderNo(res.orderId || 'NEW-ORDER');
    } else {
      setErrorMessage(res.error || '提交失败');
    }
  };

  if (submittedOrderNo) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center space-y-6">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">订购申请已成功提交！</h2>
          <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
            您的批发订购申请已发送至负责业务员（Tom Miller）。
            业务员将核实交期与多仓现货情况，核准后将为您<strong>原子预占库存 72 小时</strong>并发送形式发票。
          </p>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2 text-slate-600 max-w-sm mx-auto text-left">
          <div className="flex justify-between">
            <span className="text-slate-400">总订购数量:</span>
            <span className="font-mono font-semibold text-slate-800">{totalPcs} PCS</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">参考总金额:</span>
            <span className="font-mono font-bold text-slate-900">USD ${totalAmountUsd.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">当前订单状态:</span>
            <span className="font-semibold text-amber-600">待业务员确认 (PENDING_CONFIRMATION)</span>
          </div>
        </div>

        <div className="flex justify-center gap-3">
          <button
            onClick={() => setActiveTab('orders')}
            className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            查看我的订单进度
          </button>
          <button
            onClick={() => {
              setSubmittedOrderNo(null);
              setActiveTab('catalog');
            }}
            className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
          >
            继续浏览现货
          </button>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 text-center space-y-4">
        <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto">
          <FileText className="w-8 h-8" />
        </div>
        <h2 className="text-base font-bold text-slate-800">订购清单为空</h2>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          您尚未选择任何 SKU。请前往现货商城挑选心仪款式，每个 SKU 起订量为 10 PCS。
        </p>
        <button
          onClick={() => setActiveTab('catalog')}
          className="mt-2 px-5 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors"
        >
          前往现货商城 (Catalog)
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">订购清单 (Order List)</h1>
          <p className="text-xs text-slate-500">
            客户公司: <span className="font-medium text-slate-700">{currentCompany?.short_name}</span> · 每个 SKU 独立满足起订量 10 PCS
          </p>
        </div>
        <button
          onClick={clearCart}
          className="text-xs text-slate-400 hover:text-rose-600 flex items-center gap-1 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>清空清单</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Cart Items */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {cartLinesDetailed.map(item => {
              if (!item.sku || !item.product) return null;
              const isStockEnough = item.availableStock >= item.quantity;

              return (
                <div key={item.skuId} className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <img
                      src={item.product.primary_image}
                      alt={item.product.title}
                      className="w-16 h-16 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-100"
                    />
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        {item.product.product_code} · {item.sku.sku_code}
                      </div>
                      <div className="text-xs font-bold text-slate-900 line-clamp-1">
                        {item.product.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-black/20"
                            style={{ backgroundColor: item.sku.color_hex }}
                          />
                          <span>{item.sku.color_name}</span>
                        </span>
                        <span>·</span>
                        <span className="font-mono text-slate-700 font-semibold">
                          USD ${item.unitPrice.toFixed(2)}
                        </span>
                        {item.isPromo && (
                          <span className="text-[10px] text-rose-600 font-bold">促</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        多仓可订库存: <strong className="text-slate-700 font-mono">{item.availableStock} PCS</strong>
                        {!isStockEnough && (
                          <span className="text-rose-600 font-semibold ml-1">
                            (超出当前可订量!)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quantity Stepper & Subtotal */}
                  <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-4 self-end sm:self-center">
                    <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(item.skuId, item.quantity - 1)}
                        className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-200"
                        title={item.quantity <= SKU_MOQ ? '低于起订量 10 将移除' : '减少数量'}
                      >
                        {item.quantity <= SKU_MOQ ? (
                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                        ) : (
                          <Minus className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <input
                        type="number"
                        min={SKU_MOQ}
                        max={item.availableStock}
                        value={item.quantity}
                        onChange={e => {
                          const val = parseInt(e.target.value) || 0;
                          updateCartQuantity(item.skuId, val);
                        }}
                        className="w-14 h-9 text-center font-mono font-bold text-xs bg-transparent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(item.skuId, item.quantity + 1)}
                        disabled={item.quantity >= item.availableStock}
                        className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="text-right min-w-[80px]">
                      <div className="text-xs font-bold font-mono text-slate-900 tabular-nums">
                        ${item.subtotal.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400">小计 USD</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFromCart(item.skuId)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-50 transition-colors"
                      title="移除商品"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* PRD Non-Instant Notice */}
          <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl flex items-start gap-3 text-xs text-amber-900 leading-relaxed">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>特别提醒 (PRD 1.0 & D10):</strong> 客户在线提交的是【订购申请】，不是自动成交或在线支付订单。
              订单提交时<strong>不会立即锁库</strong>；由业务员人工核验数量无误并确认后，系统才在单笔原子事务内为您预占库存。
            </div>
          </div>
        </div>

        {/* Right 1 Col: Shipping Form & Checkout Summary */}
        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
              <Truck className="w-4 h-4 text-slate-700" />
              <span>运输与交货要求</span>
            </h2>

            {/* Shipping Method */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                期望运输方式 (Shipping Method)
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'Sea', label: '海运拼箱/整柜 (Sea)', icon: Ship },
                  { id: 'Air', label: '空运托盘 (Air)', icon: Plane },
                  { id: 'Express', label: '国际快递 (Express)', icon: Truck },
                  { id: 'Customer Pickup', label: '客户自提 (Pickup)', icon: MapPin },
                ].map(m => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setShippingMethod(m.id as Order['shipping_method'])}
                      className={`min-h-[44px] p-2 rounded-xl border text-left text-xs transition-all flex items-center gap-2 ${
                        shippingMethod === m.id
                          ? 'border-slate-900 bg-slate-900 text-white font-semibold shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Destination Country (ISO alpha-3) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                目的国家/地区 (ISO Alpha-3 Code)
              </label>
              <select
                value={destinationCountry}
                onChange={e => setDestinationCountry(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="USA">USA — 美国 (United States)</option>
                <option value="DEU">DEU — 德国 (Germany)</option>
                <option value="JPN">JPN — 日本 (Japan)</option>
                <option value="GBR">GBR — 英国 (United Kingdom)</option>
                <option value="FRA">FRA — 法国 (France)</option>
                <option value="AUS">AUS — 澳大利亚 (Australia)</option>
                <option value="CAN">CAN — 加拿大 (Canada)</option>
                <option value="ITA">ITA — 意大利 (Italy)</option>
                <option value="SGP">SGP — 新加坡 (Singapore)</option>
                <option value="UAE">UAE — 阿联酋 (United Arab Emirates)</option>
              </select>
            </div>

            {/* Expected Ship Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                期望发货日期 (Expected Ship Date)
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={expectedDate}
                  onChange={e => setExpectedDate(e.target.value)}
                  className="w-full h-11 pl-10 pr-3 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              </div>
            </div>

            {/* Shipping Requirements (with strict privacy filter) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  运输包装要求与备注
                </label>
                <span className="text-[10px] text-slate-400">严禁填写个人信息</span>
              </div>
              <textarea
                value={shippingRequirements}
                onChange={e => setShippingRequirements(e.target.value)}
                rows={3}
                placeholder="例如：需打免熏蒸托盘、外箱贴 AOKING 麦头。请勿填写姓名、电话或地址！"
                className={`w-full p-3 rounded-xl border text-xs focus:outline-none focus:ring-2 ${
                  privacyCheck.hasViolation
                    ? 'border-rose-400 bg-rose-50 text-rose-900 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-slate-900'
                }`}
              />

              {/* Privacy Warning Banner */}
              {privacyCheck.hasViolation ? (
                <div className="mt-1.5 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-[11px] leading-tight flex items-start gap-1.5 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{privacyCheck.message}</div>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>隐私合规：未检测到联系方式或地址敏感数据</span>
                </div>
              )}
            </div>

            {/* Financial Summary */}
            <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>订购总件数:</span>
                <span className="font-mono font-medium text-slate-900">{totalPcs} PCS</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>客户等级折扣:</span>
                <span className="text-emerald-700 font-semibold font-mono">
                  -{(tierDiscount * 100).toFixed(0)}% OFF
                </span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>预估运费:</span>
                <span className="text-slate-500">待业务员人工核算</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between items-baseline">
                <span className="font-bold text-slate-900">参考总计 (USD):</span>
                <span className="text-xl font-extrabold font-mono text-slate-900 tabular-nums">
                  ${totalAmountUsd.toFixed(2)}
                </span>
              </div>
            </div>

            {errorMessage && (
              <div className="p-2.5 bg-rose-50 text-rose-700 border border-rose-200 text-xs rounded-xl">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || privacyCheck.hasViolation}
              className="w-full h-12 rounded-[11px] bg-[#ff681e] hover:bg-[#ed5610] disabled:opacity-50 text-white font-bold text-xs tracking-wide transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(255,104,30,0.25)]"
            >
              <span>{submitting ? '正在提交订购申请...' : '提交现货订购申请'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
