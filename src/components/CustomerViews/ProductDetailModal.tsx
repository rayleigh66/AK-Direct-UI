/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Product, ProductSKU } from '../../types';
import { useApp } from '../../context/AppContext';
import {
  calculateSKUAvailableStock,
  calculateEffectiveUnitPrice,
  SKU_MOQ,
} from '../../utils/rules';
import {
  X,
  Plus,
  Minus,
  CheckCircle,
  AlertTriangle,
  BellRing,
  Layers,
  Sparkles,
} from 'lucide-react';

interface ProductDetailModalProps {
  product: Product;
  onClose: () => void;
  onOpenRestock: (sku: ProductSKU) => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  onClose,
  onOpenRestock,
}) => {
  const { inventory, promotions, currentCompanyTierInfo, addToCart } = useApp();
  const [selectedSkuId, setSelectedSkuId] = useState<string>(product.skus[0]?.id || '');
  const [quantity, setQuantity] = useState<number>(SKU_MOQ);
  const [addedToast, setAddedToast] = useState(false);
  const [activeImage, setActiveImage] = useState<string>(product.primary_image);

  const selectedSku = product.skus.find(s => s.id === selectedSkuId) || product.skus[0];
  const tierDiscount = currentCompanyTierInfo?.currentTier.discount_rate ?? 0;

  const { totalAvailable, totalOnHand, totalReserved } = calculateSKUAvailableStock(
    selectedSku.id,
    inventory
  );

  const priceInfo = calculateEffectiveUnitPrice(
    selectedSku.base_price_usd,
    selectedSku.id,
    tierDiscount,
    promotions
  );

  const handleAddToCart = () => {
    const res = addToCart(selectedSku.id, quantity);
    if (res.success) {
      setAddedToast(true);
      setTimeout(() => setAddedToast(false), 2500);
    } else {
      alert(res.message);
    }
  };

  const isStockSufficientForMOQ = totalAvailable >= SKU_MOQ;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-white sticky top-0 z-10">
          <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
            <span className="font-semibold text-slate-900">{product.product_code}</span>
            <span>·</span>
            <span className="truncate">{product.category}</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-5 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Gallery Column */}
            <div className="space-y-3">
              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 border border-slate-100 relative shadow-inner">
                <img
                  src={activeImage}
                  alt={product.title}
                  className="w-full h-full object-cover object-center"
                  referrerPolicy="no-referrer"
                />
                {priceInfo.isPromo && (
                  <div className="absolute top-3 left-3 bg-rose-600 text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-sm flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>限时促销</span>
                  </div>
                )}
              </div>

              {product.gallery_images.length > 1 && (
                <div className="flex gap-2">
                  {product.gallery_images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveImage(img)}
                      className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                        activeImage === img ? 'border-slate-900 shadow-sm' : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={img} alt="thumbnail" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Tech Specs Summary */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-1.5 text-slate-600">
                <div className="font-semibold text-slate-900">产品工艺与材质规格</div>
                <div>面料材质: {product.material}</div>
                <div>容量/尺寸: {product.capacity_or_size}</div>
              </div>
            </div>

            {/* Purchase & SKU Options Column */}
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-bold text-slate-900 leading-snug">
                  {product.title}
                </h1>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {product.description}
                </p>
              </div>

              {/* Price Panel */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-slate-500">参考批发价:</span>
                  <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                    USD ${priceInfo.effectivePrice.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-500">/ PCS</span>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-200/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span>基准原价: ${selectedSku.base_price_usd.toFixed(2)}</span>
                  <span>·</span>
                  <span>
                    客户等级优惠: {(tierDiscount * 100).toFixed(0)}% OFF (
                    {currentCompanyTierInfo?.currentTier.name})
                  </span>
                  {priceInfo.isPromo && (
                    <>
                      <span>·</span>
                      <span className="text-rose-600 font-medium">
                        促销价 ${priceInfo.promoPrice?.toFixed(2)} (
                        {priceInfo.isStacked ? '已叠加等级折扣' : '促销不叠加等级折扣'})
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* SKU Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  选择颜色规格 (SKU)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {product.skus.map(sku => {
                    const skuAvail = calculateSKUAvailableStock(sku.id, inventory).totalAvailable;
                    const isSelected = sku.id === selectedSkuId;
                    return (
                      <button
                        key={sku.id}
                        onClick={() => setSelectedSkuId(sku.id)}
                        className={`text-left p-2.5 rounded-xl border text-xs transition-all relative ${
                          isSelected
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/20 shrink-0"
                            style={{ backgroundColor: sku.color_hex }}
                          />
                          <span className="font-semibold truncate">{sku.color_name}</span>
                        </div>
                        <div
                          className={`text-[11px] tabular-nums ${
                            isSelected ? 'text-slate-300' : skuAvail >= SKU_MOQ ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          {skuAvail === 0
                            ? '缺货 (0 PCS)'
                            : skuAvail < SKU_MOQ
                            ? `仅剩 ${skuAvail} PCS (< MOQ)`
                            : `可订: ${skuAvail} PCS`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Exact Stock Summary Box */}
              <div className="p-3 bg-slate-100/70 rounded-xl text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">当前选定 SKU:</span>
                  <span className="font-mono font-semibold text-slate-800">{selectedSku.sku_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">多仓汇总精确可订库存:</span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {totalAvailable} PCS
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>(账面实存 {totalOnHand} PCS · 业务员预占 {totalReserved} PCS)</span>
                  <span>起订量 MOQ: 10 PCS</span>
                </div>
              </div>

              {/* Quantity Selector & Action Button */}
              {isStockSufficientForMOQ ? (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">订购数量 (PCS)</span>
                    <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden bg-white">
                      <button
                        onClick={() => setQuantity(q => Math.max(SKU_MOQ, q - 1))}
                        disabled={quantity <= SKU_MOQ}
                        className="w-10 h-10 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min={SKU_MOQ}
                        max={totalAvailable}
                        value={quantity}
                        onChange={e => {
                          const val = parseInt(e.target.value) || 0;
                          setQuantity(val);
                        }}
                        className="w-16 h-10 text-center font-mono font-bold text-sm focus:outline-none"
                      />
                      <button
                        onClick={() => setQuantity(q => Math.min(totalAvailable, q + 1))}
                        disabled={quantity >= totalAvailable}
                        className="w-10 h-10 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 text-right">
                    小计: <strong className="text-slate-900 font-mono">USD ${(priceInfo.effectivePrice * quantity).toFixed(2)}</strong>
                  </div>

                  <button
                    onClick={handleAddToCart}
                    className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Layers className="w-4 h-4" />
                    <span>加入订购清单</span>
                  </button>

                  {addedToast && (
                    <div className="p-2 bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs rounded-xl flex items-center justify-center gap-1.5 animate-in fade-in">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span>已加入订购清单！可进入清单调整及提交申请</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3">
                  <div className="flex items-start gap-2 text-xs text-amber-800">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      {totalAvailable === 0
                        ? '该 SKU 当前现货已售罄，无法直接下单。'
                        : `该 SKU 剩余库存 (${totalAvailable} PCS) 低于起订量 ${SKU_MOQ} PCS，无法正常下单。`}
                      可登记补货需求，到货将优先通知。
                    </div>
                  </div>

                  <button
                    onClick={() => onOpenRestock(selectedSku)}
                    className="w-full h-11 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    <BellRing className="w-4 h-4" />
                    <span>申请补货 (Request Restock)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
