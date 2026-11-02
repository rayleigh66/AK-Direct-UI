import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Minus, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  calculateEffectiveUnitPrice,
  calculateSKUAvailableStock,
  SKU_MOQ,
} from '../../utils/rules';
import { customerProductTitle, customerSkuColor } from '../../utils/customerDisplay';
import type { ProductSKU } from '../../types';

interface ProductDetailSheetProps {
  skuId: string;
  onClose: () => void;
}

export const ProductDetailSheet: React.FC<ProductDetailSheetProps> = ({ skuId, onClose }) => {
  const {
    products,
    inventory,
    promotions,
    currentCompanyTierInfo,
    cart,
    addToCart,
    addToast,
    setActiveTab,
  } = useApp();

  const found = useMemo(() => {
    for (const product of products) {
      if (product.active === false) continue;
      const sku = product.skus.find(
        (item) =>
          (item.id === skuId || item.sku_code === skuId) &&
          item.sellable_status === 'active'
      );
      if (sku) return { product, sku };
    }
    return null;
  }, [products, skuId]);

  const [selectedSkuId, setSelectedSkuId] = useState(found?.sku.id ?? '');
  const [quantity, setQuantity] = useState(SKU_MOQ);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);
  const [activeImageUrl, setActiveImageUrl] = useState('');

  useEffect(() => {
    setSelectedSkuId(found?.sku.id ?? '');
  }, [found?.sku.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const availableSkus =
    found?.product.skus.filter((item) => item.sellable_status === 'active') ?? [];
  const selectedSku: ProductSKU | undefined =
    availableSkus.find((item) => item.id === selectedSkuId) ?? found?.sku;
  const tierDiscount = currentCompanyTierInfo?.currentTier.discount_rate ?? 0;
  const stock = selectedSku
    ? calculateSKUAvailableStock(selectedSku.id, inventory).totalAvailable
    : 0;
  const existing = selectedSku
    ? cart.find((item) => item.sku_id === selectedSku.id)?.quantity ?? 0
    : 0;
  const priceInfo = selectedSku
    ? calculateEffectiveUnitPrice(
        selectedSku.base_price_usd,
        selectedSku.id,
        tierDiscount,
        promotions
      )
    : null;
  const galleryUrls = found
    ? [
        ...new Set(
          [
            selectedSku?.image_url,
            found.product.primary_image,
            ...found.product.gallery_images,
          ].filter((url): url is string => !!url)
        ),
      ]
    : [];
  const image = activeImageUrl && galleryUrls.includes(activeImageUrl)
    ? activeImageUrl
    : selectedSku?.image_url ?? found?.product.primary_image ?? '';

  useEffect(() => {
    setQuantity(SKU_MOQ);
    setError('');
    setAdded(false);
    setActiveImageUrl(selectedSku?.image_url ?? found?.product.primary_image ?? '');
  }, [selectedSkuId, selectedSku?.image_url, found?.product.primary_image]);

  if (!found || !selectedSku || !priceInfo) return null;

  const product = found.product;
  const setSafeQuantity = (next: number) => {
    setQuantity(next);
    setError('');
    setAdded(false);
  };
  const add = () => {
    if (!Number.isInteger(quantity) || quantity < SKU_MOQ) {
      setError(`Minimum order quantity is ${SKU_MOQ} PCS per SKU.`);
      return;
    }
    const nextTotal = existing + quantity;
    if (nextTotal > stock) {
      setError(`Only ${stock} PCS are available for this SKU.`);
      return;
    }
    const result = addToCart(selectedSku.id, nextTotal);
    if (!result.success) {
      setError(result.message ?? 'Could not add this SKU.');
      return;
    }
    setError('');
    setAdded(true);
    addToast(`${quantity} PCS added to your order list`);
  };

  return (
    <div className="fixed inset-0 z-[95] bg-[#101010]/45 backdrop-blur-[2px]" data-testid="product-detail">
      <section
        className="absolute inset-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[520px] bg-white flex flex-col shadow-[-18px_0_60px_rgba(0,0,0,0.16)] animate-in slide-in-from-right duration-200"
        aria-label="Product details"
      >
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-[#e8e8e6]">
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-[1.4px] uppercase text-[#8f9191]">
              {product.product_code}
            </div>
            <div className="text-sm font-bold text-[#151515] truncate">
              {customerProductTitle(product)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="w-10 h-10 shrink-0 rounded-[10px] border border-[#e8e8e6] bg-white flex items-center justify-center text-[#4f5150] hover:bg-[#f6f6f4]"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 space-y-5">
          <div className="relative aspect-[4/3] rounded-[14px] overflow-hidden bg-[#f8f8f6] border border-[#eaeae7]">
            <img
              src={image}
              alt={customerProductTitle(product)}
              width={1000}
              height={746}
              loading="eager"
              decoding="async"
              className="w-full h-full object-cover"
            />
            {priceInfo.isPromo && (
              <span className="absolute top-3 left-3 bg-[#ff681e] text-white text-[10px] font-bold px-2 py-1 rounded-[6px] flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Limited offer
              </span>
            )}
          </div>
          {galleryUrls.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Product images">
              {galleryUrls.map(url => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setActiveImageUrl(url)}
                  aria-pressed={image === url}
                  className={`w-14 h-14 rounded-[8px] overflow-hidden border shrink-0 ${
                    image === url ? 'border-[#ff681e] ring-1 ring-[#ff681e]' : 'border-[#e8e8e6]'
                  }`}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}

          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-[#151515] leading-snug">
              {customerProductTitle(product)}
            </h1>
            <p className="text-xs text-[#858789] mt-1">
              {selectedSku.sku_code} · {customerSkuColor(selectedSku)}
            </p>
          </div>

          <section aria-label="Choose a colour" className="space-y-2">
            <div className="text-xs font-bold text-[#151515]">Colour</div>
            <div className="grid grid-cols-2 gap-2" data-testid="color-options">
              {availableSkus.map((sku) => {
                const skuStock = calculateSKUAvailableStock(sku.id, inventory).totalAvailable;
                const selected = sku.id === selectedSku.id;
                return (
                  <button
                    key={sku.id}
                    type="button"
                    onClick={() => setSelectedSkuId(sku.id)}
                    aria-pressed={selected}
                    data-testid="sku-color"
                    className={`min-h-[48px] rounded-[10px] border px-3 py-2 flex items-center gap-2 text-left transition-colors ${
                      selected
                        ? 'border-[#ff681e] bg-[#fff7f2] shadow-[0_0_0_1px_#ff681e]'
                        : 'border-[#e8e8e6] bg-white hover:border-[#c9c9c5]'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-black/20 shrink-0"
                      style={{ backgroundColor: sku.color_hex }}
                    />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold text-[#151515] truncate">
                        {customerSkuColor(sku)}
                      </span>
                      <span
                        className={`block text-[10px] ${
                          skuStock >= SKU_MOQ ? 'text-[#198364]' : 'text-[#d34f36]'
                        }`}
                      >
                        {skuStock >= SKU_MOQ ? `${skuStock} PCS available` : `Only ${skuStock} PCS`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[12px] border border-[#eaeae7] bg-[#fafaf9] p-3">
              <div className="text-[10px] text-[#8f9191]">Reference wholesale price</div>
              <div className="font-mono font-extrabold text-lg text-[#151515] mt-1">
                USD ${priceInfo.effectivePrice.toFixed(2)}
                <span className="text-[10px] font-normal text-[#999]"> /PCS</span>
              </div>
              {priceInfo.isPromo && (
                <div className="text-[10px] text-[#dd4a00] font-semibold mt-0.5">
                  {priceInfo.isStacked ? 'Promo + member discount' : 'Limited-time promo'}
                </div>
              )}
            </div>
            <div className="rounded-[12px] border border-[#eaeae7] bg-[#fafaf9] p-3">
              <div className="text-[10px] text-[#8f9191]">Available across warehouses</div>
              <div
                className={`font-mono font-extrabold text-lg mt-1 ${
                  stock >= SKU_MOQ ? 'text-[#198364]' : 'text-[#d34f36]'
                }`}
              >
                {stock} PCS
              </div>
              <div className="text-[10px] text-[#999] mt-0.5">MOQ {SKU_MOQ} PCS / SKU</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-[#eaeae7] p-3">
            <div>
              <div className="text-xs font-bold text-[#151515]">Quantity</div>
              <div className="text-[10px] text-[#999]">
                {existing > 0 ? `${existing} PCS already in your list` : 'Not in your list yet'}
              </div>
            </div>
            <div className="flex items-center rounded-[10px] border border-[#e8e8e6] bg-[#fafaf9] overflow-hidden">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setSafeQuantity(Math.max(SKU_MOQ, quantity - 1))}
                disabled={quantity <= SKU_MOQ}
                className="w-11 h-11 flex items-center justify-center text-[#4f5150] disabled:opacity-35"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                aria-label="Quantity in PCS"
                data-testid="quantity-input"
                type="number"
                min={SKU_MOQ}
                max={stock}
                value={quantity}
                onChange={(event) => setSafeQuantity(Number(event.target.value) || 0)}
                className="w-14 h-11 text-center bg-transparent font-mono font-bold text-sm outline-none"
              />
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setSafeQuantity(Math.min(Math.max(stock, SKU_MOQ), quantity + 1))}
                disabled={quantity >= stock}
                className="w-11 h-11 flex items-center justify-center text-[#4f5150] disabled:opacity-35"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="rounded-[12px] bg-[#f5f5f3] border border-[#eaeae7] p-3 text-xs text-[#666] leading-relaxed">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-[#198364] shrink-0 mt-0.5" />
              <span>
                Submitting an order request does not reserve stock. Your sales representative confirms
                the final quantity and warehouse allocation before the demo reservation is created.
              </span>
            </div>
            <div className="mt-2 text-[11px] text-[#8f9191]">
              {product.description_en || product.description}
            </div>
            <div className="mt-2 text-[11px] text-[#8f9191]">
              Material: {product.material} · Capacity: {product.capacity_or_size}
            </div>
          </div>
        </div>

        <footer className="shrink-0 border-t border-[#e8e8e6] bg-white px-4 sm:px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {error && (
            <p role="alert" className="mb-2 text-[11px] font-semibold text-[#d34f36]">
              {error}
            </p>
          )}
          {added && (
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#198364]">
              <CheckCircle2 className="w-4 h-4" />
              Added to your order list.
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={add}
              disabled={stock < SKU_MOQ}
              data-testid="add-to-order"
              className="flex-1 min-h-[48px] rounded-[10px] bg-[#ff681e] text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-[0_4px_14px_rgba(255,104,30,0.25)]"
            >
              Add {quantity} PCS
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                setActiveTab('cart');
              }}
              aria-label="View order list"
              className="w-12 h-12 shrink-0 rounded-[10px] border border-[#e8e8e6] bg-white flex items-center justify-center text-[#343434]"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {stock < SKU_MOQ && (
            <p className="mt-2 text-[11px] text-[#d34f36]">
              This SKU is below the {SKU_MOQ} PCS MOQ. Request a restock from the catalog.
            </p>
          )}
        </footer>
      </section>
    </div>
  );
};
