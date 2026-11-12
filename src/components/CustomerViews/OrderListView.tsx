/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { Order } from '../../types';
import { customerProductTitle, customerSkuColor } from '../../utils/customerDisplay';
import { QuantityField } from '../ui/QuantityField';
import { HelpTooltip } from '../ui/HelpTooltip';
import { EnglishDateField } from '../ui/EnglishDateField';
import { formatEnglishDate } from '../../utils/dateDisplay';

function shippingDraftKey(companyId?: string) {
  return `aoking-shipping-draft:${companyId ?? 'guest'}`;
}

function readShippingDraft(companyId?: string) {
  try {
    const raw = sessionStorage.getItem(shippingDraftKey(companyId));
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

export const OrderListView: React.FC = () => {
  const {
    cart,
    products,
    inventory,
    promotions,
    currentCompanyTierInfo,
    currentCompany,
    currentCustomerUser,
    brandGrants,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    submitOrder,
    setActiveTab,
  } = useApp();

  const initialShippingDraft = useMemo(
    () => readShippingDraft(currentCompany?.id),
    [currentCompany?.id]
  );
  const [shippingMethod, setShippingMethod] = useState<Order['shipping_method']>(() => {
    const saved = initialShippingDraft?.shippingMethod;
    return saved === 'Sea' || saved === 'Air' || saved === 'Express' || saved === 'Customer Pickup'
      ? (saved as Order['shipping_method'])
      : 'Sea';
  });
  const [destinationCountry, setDestinationCountry] = useState<string>(
    initialShippingDraft?.destinationCountry || currentCompany?.country_alpha3 || 'USA'
  );
  const [expectedDate, setExpectedDate] = useState<string>(
    initialShippingDraft?.expectedDate ||
      new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [shippingRequirements, setShippingRequirements] = useState<string>(
    initialShippingDraft?.shippingRequirements ||
      'Standard export master cartons with pallet stretch wrap. AOKING barcode labels required.'
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(
        shippingDraftKey(currentCompany?.id),
        JSON.stringify({ shippingMethod, destinationCountry, expectedDate, shippingRequirements })
      );
    } catch {
      /* local draft is a convenience; ignore storage failures */
    }
  }, [currentCompany?.id, shippingMethod, destinationCountry, expectedDate, shippingRequirements]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);

  useEffect(() => {
    setQuantityDrafts(
      Object.fromEntries(cart.map((item) => [item.sku_id, String(item.quantity)]))
    );
  }, [cart]);

  const tierDiscount = currentCompanyTierInfo?.currentTier.discount_rate ?? 0;

  const applyQuantity = (skuId: string, nextQuantity: number) => {
    const result = updateCartQuantity(skuId, nextQuantity);
    if (!result.success) {
      setLineErrors((prev) => ({
        ...prev,
        [skuId]: result.message ?? 'Invalid quantity.',
      }));
      return false;
    }
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[skuId];
      return next;
    });
    setQuantityDrafts((prev) => ({ ...prev, [skuId]: String(nextQuantity) }));
    return true;
  };

  const commitQuantityDraft = (skuId: string) => {
    const raw = quantityDrafts[skuId] ?? '';
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < SKU_MOQ) {
      setLineErrors((prev) => ({
        ...prev,
        [skuId]: `Minimum ${SKU_MOQ} whole PCS per SKU. Use Remove to delete this line.`,
      }));
      return;
    }
    applyQuantity(skuId, parsed);
  };

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
    const brandAuthorized = !!prodObj &&
      brandGrants.some(
        grant =>
          grant.company_id === currentCompany?.id && grant.brand_id === prodObj.brand_id
      );
    const unavailableReason =
      !currentCustomerUser || currentCustomerUser.status !== 'active'
        ? 'Your customer account is inactive.'
        : !currentCompany || currentCompany.status !== 'active'
          ? 'Your customer company is inactive.'
          : !prodObj || prodObj.active === false
            ? 'This product is no longer available.'
            : !skuObj || skuObj.sellable_status !== 'active'
              ? 'This SKU is no longer available.'
              : !brandAuthorized
                ? 'Your company is no longer authorized for this brand.'
                : '';

    return {
      skuId: item.sku_id,
      quantity: item.quantity,
      sku: skuObj,
      product: prodObj,
      availableStock: totalAvailable,
      unitPrice: priceInfo.effectivePrice,
      isPromo: priceInfo.isPromo,
      subtotal: priceInfo.effectivePrice * item.quantity,
      unavailableReason,
    };
  });

  const totalAmountUsd = cartLinesDetailed.reduce((sum, item) => sum + item.subtotal, 0);
  const totalPcs = cartLinesDetailed.reduce((sum, item) => sum + item.quantity, 0);
  const hasUnavailableLine = cartLinesDetailed.some(item => item.unavailableReason);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setErrorMessage('');

    if (cart.length === 0) {
      setErrorMessage('Your order list is empty.');
      return;
    }
    if (!expectedDate) {
      setErrorMessage('Choose an expected ship date.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
      setErrorMessage('Expected ship date must be a valid date.');
      return;
    }
    if (privacyCheck.hasViolation) {
      setErrorMessage(privacyCheck.message ?? 'Privacy check failed.');
      return;
    }
    if (hasUnavailableLine) {
      setErrorMessage('Remove unavailable products or restore their availability before submitting.');
      return;
    }
    if (Object.keys(lineErrors).length > 0) {
      setErrorMessage('Resolve the quantity errors before submitting.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    const res = submitOrder({
      shippingMethod,
      destinationCountryAlpha3: destinationCountry,
      expectedShipDate: expectedDate,
      shippingRequirements,
    });

    if (res.success) {
      try {
        sessionStorage.removeItem(shippingDraftKey(currentCompany?.id));
      } catch {
        /* ignore */
      }
      setSubmittedOrder(
        res.order
          ? { ...res.order, lines: res.order.lines.map((line) => ({ ...line })) }
          : null
      );
    } else {
      submittingRef.current = false;
      setSubmitting(false);
      setErrorMessage(res.error || 'Order request failed.');
    }
  };

  if (submittedOrder) {
    const submittedPcs = submittedOrder.lines.reduce((sum, line) => sum + line.quantity, 0);
    const submittedTotal = submittedOrder.total_confirmed_usd ?? submittedOrder.total_quoted_usd;
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center space-y-6">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Order request submitted</h2>
          <p className="text-xs font-mono font-semibold text-slate-500 mt-1">
            {submittedOrder.order_no}
          </p>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-slate-500">
            <span>Sent to your sales representative for final confirmation.</span>
            <HelpTooltip label="What happens after submission" align="right">
              They will verify lead time and multi-warehouse availability, then create a 72-hour
              demo stock reservation and issue a proforma invoice.
            </HelpTooltip>
          </p>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2 text-slate-600 max-w-sm mx-auto text-left">
          <div className="flex justify-between">
            <span className="text-slate-400">Order number:</span>
            <span data-testid="success-order-no" className="font-mono font-semibold text-slate-800">{submittedOrder.order_no}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Total quantity:</span>
            <span data-testid="success-total-pcs" className="font-mono font-semibold text-slate-800">
              {submittedPcs} PCS
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Reference total:</span>
            <span data-testid="success-total-usd" className="font-mono font-bold text-slate-900">
              USD ${submittedTotal.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Expected ship:</span>
            <span data-testid="success-expected-ship" className="font-semibold text-slate-800">
              {formatEnglishDate(submittedOrder.expected_ship_date)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Current status:</span>
            <span className="font-semibold text-amber-600">Pending confirmation</span>
          </div>
        </div>

        <div className="flex justify-center gap-3">
          <button
            onClick={() => setActiveTab('orders')}
            className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            View my orders
          </button>
          <button
            onClick={() => {
              setSubmittedOrder(null);
              setActiveTab('catalog');
            }}
            className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
          >
            Continue shopping
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
        <h2 className="text-base font-bold text-slate-800">Your order list is empty</h2>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Choose a colour in the catalog first. Each SKU has a 10 PCS minimum order quantity.
        </p>
        <button
          onClick={() => setActiveTab('catalog')}
          className="mt-2 px-5 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors"
        >
          Browse the catalog
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Order list</h1>
          <p className="text-xs text-slate-500">
            Company: <span className="font-medium text-slate-700">{currentCompany?.short_name}</span> · 10 PCS MOQ per SKU
          </p>
        </div>
        <button
          onClick={clearCart}
          className="text-xs text-slate-400 hover:text-rose-600 flex items-center gap-1 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear list</span>
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
                      alt={customerProductTitle(item.product)}
                      width={64}
                      height={64}
                      loading="lazy"
                      decoding="async"
                      className="w-16 h-16 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-100"
                    />
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        {item.product.product_code} · {item.sku.sku_code}
                      </div>
                      <div className="text-xs font-bold text-slate-900 line-clamp-1">
                        {customerProductTitle(item.product)}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-black/20"
                            style={{ backgroundColor: item.sku.color_hex }}
                          />
                          <span>{customerSkuColor(item.sku)}</span>
                        </span>
                        <span>·</span>
                        <span className="font-mono text-slate-700 font-semibold">
                          USD ${item.unitPrice.toFixed(2)}
                        </span>
                        {item.isPromo && (
                          <span className="text-[10px] text-rose-600 font-bold">Promo</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Available: <strong className="text-slate-700 font-mono">{item.availableStock} PCS</strong>
                        {!isStockEnough && (
                          <span className="text-rose-600 font-semibold ml-1">
                            (exceeds available stock)
                          </span>
                        )}
                      </div>
                      {item.unavailableReason && (
                        <p role="alert" className="text-[10px] font-semibold text-rose-600 mt-1">
                          {item.unavailableReason} Remove it before submitting.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Quantity Stepper & Subtotal */}
                  <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-4 self-end sm:self-center">
                    <div>
                      <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => applyQuantity(item.skuId, Math.max(SKU_MOQ, item.quantity - 1))}
                          className="w-11 h-11 flex items-center justify-center text-slate-600 hover:bg-slate-200"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <QuantityField
                          ariaLabel={`Quantity for ${item.sku.sku_code}`}
                          testId={`cart-quantity-${item.skuId}`}
                          min={SKU_MOQ}
                          max={item.availableStock}
                          value={quantityDrafts[item.skuId] ?? String(item.quantity)}
                          onValueChange={value =>
                            setQuantityDrafts(prev => ({ ...prev, [item.skuId]: value }))
                          }
                          onBlur={() => commitQuantityDraft(item.skuId)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitQuantityDraft(item.skuId);
                            }
                          }}
                          className="w-14 h-11 text-center font-mono font-bold text-xs bg-transparent focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => applyQuantity(item.skuId, item.quantity + 1)}
                          disabled={item.quantity >= item.availableStock}
                          aria-label="Increase quantity"
                          className="w-11 h-11 flex items-center justify-center text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {lineErrors[item.skuId] && (
                        <p role="alert" className="mt-1 max-w-[190px] text-[10px] font-semibold text-rose-600">
                          {lineErrors[item.skuId]}
                        </p>
                      )}
                    </div>

                    <div className="text-right min-w-[80px]">
                      <div className="text-xs font-bold font-mono text-slate-900 tabular-nums">
                        ${item.subtotal.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400">Line total USD</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFromCart(item.skuId)}
                      className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-50 transition-colors"
                      aria-label="Remove item"
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
            <div className="flex flex-wrap items-center gap-1.5">
              <strong>Order request, not an instant sale.</strong>
              <HelpTooltip label="Order request and reservation details">
                Submitting does not lock stock. A sales representative verifies quantities and
                availability before the demo whole-order reservation is created. This is not a
                database transaction.
              </HelpTooltip>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Shipping Form & Checkout Summary */}
        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
              <Truck className="w-4 h-4 text-slate-700" />
              <span>Shipping & delivery preferences</span>
            </h2>

            {/* Shipping Method */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Shipping method
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'Sea', label: 'Sea freight', icon: Ship },
                  { id: 'Air', label: 'Air freight', icon: Plane },
                  { id: 'Express', label: 'Express courier', icon: Truck },
                  { id: 'Customer Pickup', label: 'Customer pickup', icon: MapPin },
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
                Destination country (ISO alpha-3)
              </label>
              <select
                value={destinationCountry}
                onChange={e => setDestinationCountry(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="USA">USA — United States</option>
                <option value="DEU">DEU — Germany</option>
                <option value="JPN">JPN — Japan</option>
                <option value="GBR">GBR — United Kingdom</option>
                <option value="FRA">FRA — France</option>
                <option value="AUS">AUS — Australia</option>
                <option value="CAN">CAN — Canada</option>
                <option value="ITA">ITA — Italy</option>
                <option value="SGP">SGP — Singapore</option>
                <option value="UAE">UAE — United Arab Emirates</option>
              </select>
            </div>

            {/* Expected Ship Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Expected ship date
              </label>
              <EnglishDateField
                value={expectedDate}
                onChange={setExpectedDate}
                ariaLabel="Expected ship date"
                testId="expected-ship-date"
                required
              />
            </div>

            {/* Shipping Requirements (with strict privacy filter) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Packing requirements & notes
                </label>
                <span className="text-[10px] text-slate-400">No personal information</span>
              </div>
              <textarea
                value={shippingRequirements}
                onChange={e => setShippingRequirements(e.target.value)}
                rows={3}
                placeholder="e.g. fumigation-free pallet, AOKING shipping marks. Do not enter names, phone numbers or addresses."
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
                  <span>Privacy check passed: no contact details or address detected</span>
                </div>
              )}
            </div>

            {/* Financial Summary */}
            <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Total quantity:</span>
                <span className="font-mono font-medium text-slate-900">{totalPcs} PCS</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Member discount:</span>
                <span className="text-emerald-700 font-semibold font-mono">
                  -{(tierDiscount * 100).toFixed(0)}% OFF
                </span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Estimated freight:</span>
                <span className="text-slate-500">Confirmed by sales</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between items-baseline">
                <span className="font-bold text-slate-900">Reference total (USD):</span>
                <span className="text-xl font-extrabold font-mono text-slate-900 tabular-nums">
                  ${totalAmountUsd.toFixed(2)}
                </span>
              </div>
            </div>

            {errorMessage && (
              <div role="alert" aria-live="polite" className="p-2.5 bg-rose-50 text-rose-700 border border-rose-200 text-xs rounded-xl">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              data-testid="submit-order"
              disabled={submitting || privacyCheck.hasViolation || hasUnavailableLine}
              className="w-full h-12 rounded-[11px] bg-[#ff681e] hover:bg-[#ed5610] disabled:opacity-50 text-white font-bold text-xs tracking-wide transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(255,104,30,0.25)]"
            >
              <span>{submitting ? 'Submitting order request...' : 'Submit order request'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
