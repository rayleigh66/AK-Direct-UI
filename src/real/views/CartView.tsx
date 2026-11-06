import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  Package,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
} from 'lucide-react';
import type { AuthUserDto } from '../../auth/api';
import { AuthApiError } from '../../auth/api';
import { checkPrivacyViolations } from '../../utils/rules';
import { useRealCart, usdFromCents } from '../cart';
import { submitOrder } from '../api';
import type { CustomerOrderDto, ShippingMethod } from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';

const SHIPPING_METHODS: ShippingMethod[] = [
  'Express',
  'Air',
  'Sea',
  'Customer Pickup',
  'Other',
];

const DRAFT_VERSION = 1;

interface ShippingDraft {
  shippingMethod: ShippingMethod | '';
  destinationCountryAlpha3: string;
  expectedShipDate: string;
  shippingRequirements: string;
}

const EMPTY_DRAFT: ShippingDraft = {
  shippingMethod: '',
  destinationCountryAlpha3: '',
  expectedShipDate: '',
  shippingRequirements: '',
};

function draftKey(companyId: string | undefined): string {
  return `aoking.real.shippingDraft.${companyId ?? 'unknown'}`;
}

function readDraft(companyId: string | undefined): ShippingDraft {
  try {
    const raw = window.localStorage.getItem(draftKey(companyId));
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<ShippingDraft> & { version?: number };
    if (parsed.version !== DRAFT_VERSION) return EMPTY_DRAFT;
    return {
      shippingMethod: (parsed.shippingMethod as ShippingMethod | '') ?? '',
      destinationCountryAlpha3: parsed.destinationCountryAlpha3 ?? '',
      expectedShipDate: parsed.expectedShipDate ?? '',
      shippingRequirements: parsed.shippingRequirements ?? '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `order-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export const CartView: React.FC<{
  user: AuthUserDto;
  onBrowse: () => void;
  onViewOrders: () => void;
}> = ({ user, onBrowse, onViewOrders }) => {
  const { cart, loading, error, refresh, setItem, removeItem, clear } = useRealCart();
  const [draft, setDraft] = useState<ShippingDraft>(() => readDraft(user.companyId));
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [busySku, setBusySku] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<CustomerOrderDto | null>(null);
  const idempotency = useRef<{ revision: number; key: string } | null>(null);

  useEffect(() => {
    if (!cart) return;
    setQuantities(
      Object.fromEntries(cart.items.map(item => [item.skuId, String(item.quantity)]))
    );
  }, [cart]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        draftKey(user.companyId),
        JSON.stringify({ version: DRAFT_VERSION, ...draft })
      );
    } catch {
      /* Local draft is a convenience only; the server snapshot is authoritative. */
    }
  }, [draft, user.companyId]);

  const privacy = useMemo(
    () => checkPrivacyViolations(draft.shippingRequirements),
    [draft.shippingRequirements]
  );

  if (loading && !cart) return <LoadingBlock label="Loading your company cart…" />;
  if (error && !cart) return <ErrorBlock message={error} onRetry={refresh} />;
  if (!cart) return <ErrorBlock message={error || 'The cart is unavailable.'} onRetry={refresh} />;

  if (success) {
    const pieces = success.lines.reduce((sum, line) => sum + line.quantity, 0);
    return (
      <div
        className="max-w-2xl mx-auto bg-white border border-emerald-200 rounded-2xl p-5 sm:p-8 space-y-4"
        data-testid="cart-success"
      >
        <div className="flex items-center gap-3 text-emerald-700">
          <CheckCircle2 className="w-7 h-7" />
          <h2 className="text-lg font-extrabold">Order submitted</h2>
        </div>
        <p className="text-sm text-slate-600">
          AOKING Direct sales will verify quantities, price and stock before confirming. Submitting
          this request did not reserve stock.
        </p>
        <dl className="grid sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <dt className="text-slate-400">Order number</dt>
            <dd className="font-mono font-bold text-sm" data-testid="success-order-no">
              {success.orderNo}
            </dd>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <dt className="text-slate-400">Total pieces</dt>
            <dd className="font-bold text-sm" data-testid="success-pcs">
              {pieces} PCS
            </dd>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <dt className="text-slate-400">Reference total</dt>
            <dd className="font-bold text-sm" data-testid="success-total">
              {usdFromCents(success.referenceTotalCents)}
            </dd>
          </div>
        </dl>
        <div className="rounded-xl bg-[#fff7f2] border border-[#ffeadb] p-3 text-[11px] text-[#8a4d2c]">
          {success.priceNote}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onViewOrders}
            className="min-h-[44px] px-4 rounded-xl bg-[#ff681e] text-white text-sm font-bold"
          >
            View my orders
          </button>
          <button
            type="button"
            onClick={onBrowse}
            className="min-h-[44px] px-4 rounded-xl border border-slate-300 text-sm font-semibold"
          >
            Continue browsing
          </button>
        </div>
      </div>
    );
  }

  const changeQuantity = (skuId: string, delta: number) => {
    const current = Number(quantities[skuId] ?? '0');
    const next = Math.max(10, Number.isFinite(current) ? current + delta : 10);
    setQuantities(prev => ({ ...prev, [skuId]: String(next) }));
  };

  const saveQuantity = async (skuId: string) => {
    const parsed = Number(quantities[skuId]);
    if (!Number.isInteger(parsed) || parsed < 10) {
      setLineErrors(prev => ({
        ...prev,
        [skuId]: 'Minimum 10 whole PCS. Use Remove to delete this line.',
      }));
      return;
    }
    setBusySku(skuId);
    setLineErrors(prev => {
      const next = { ...prev };
      delete next[skuId];
      return next;
    });
    try {
      await setItem(skuId, parsed);
    } catch (err) {
      setLineErrors(prev => ({
        ...prev,
        [skuId]: err instanceof Error ? err.message : 'The quantity could not be saved.',
      }));
    } finally {
      setBusySku(null);
    }
  };

  const remove = async (skuId: string) => {
    setBusySku(skuId);
    try {
      await removeItem(skuId);
    } catch (err) {
      setLineErrors(prev => ({
        ...prev,
        [skuId]: err instanceof Error ? err.message : 'The line could not be removed.',
      }));
    } finally {
      setBusySku(null);
    }
  };

  const validateForm = (): string => {
    if (!draft.shippingMethod) return 'Select a shipping method.';
    if (!/^[A-Za-z]{3}$/.test(draft.destinationCountryAlpha3.trim())) {
      return 'Enter the destination country as an ISO three-letter code (for example USA).';
    }
    if (!draft.expectedShipDate) return 'Choose an expected ship date.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expectedShipDate)) {
      return 'Expected ship date must use YYYY-MM-DD.';
    }
    if (privacy.hasViolation) return privacy.message ?? 'Privacy check failed.';
    if (cart.hasUnavailableItems) {
      return 'Remove unavailable products before submitting.';
    }
    if (Object.keys(lineErrors).length > 0) {
      return 'Resolve the quantity errors before submitting.';
    }
    return '';
  };

  const openConfirm = () => {
    const message = validateForm();
    setFormError(message);
    if (!message) setConfirmOpen(true);
  };

  const confirmSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setFormError('');
    if (!idempotency.current || idempotency.current.revision !== cart.revision) {
      idempotency.current = { revision: cart.revision, key: newIdempotencyKey() };
    }
    try {
      const result = await submitOrder({
        idempotencyKey: idempotency.current.key,
        expectedCartRevision: cart.revision,
        shippingMethod: draft.shippingMethod as ShippingMethod,
        destinationCountryAlpha3: draft.destinationCountryAlpha3.trim().toUpperCase(),
        expectedShipDate: draft.expectedShipDate,
        shippingRequirements: draft.shippingRequirements,
      });
      setConfirmOpen(false);
      idempotency.current = null;
      try {
        window.localStorage.removeItem(draftKey(user.companyId));
      } catch {
        /* ignore storage failures */
      }
      setSuccess(result.order);
      await refresh();
    } catch (err) {
      setFormError(
        err instanceof AuthApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'The order could not be submitted.'
      );
      setConfirmOpen(false);
      if (err instanceof AuthApiError && err.details.cart) {
        idempotency.current = null;
      }
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const totalPieces = cart.totalQuantity;

  return (
    <div className="space-y-4">
      {error && <ErrorBlock message={error} onRetry={refresh} />}
      {formError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {formError}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-[#ff681e]" />
          <h2 className="text-base font-extrabold">Company shared cart</h2>
          <span className="text-[11px] text-slate-500">
            Every account of {user.companyName ?? user.companyCode ?? 'your company'} sees this cart.
          </span>
          <span
            className="ml-auto text-[11px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-700"
            data-testid="cart-pieces"
          >
            {cart.itemCount} lines · {totalPieces} PCS
          </span>
          {cart.itemCount > 0 && (
            <button
              type="button"
              onClick={() => setClearOpen(true)}
              className="min-h-[38px] px-3 rounded-xl border border-slate-300 text-xs font-semibold"
              data-testid="cart-clear"
            >
              Clear cart
            </button>
          )}
        </div>
        {clearOpen && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex flex-wrap items-center gap-2">
            <span className="flex-1">Remove every line from the shared company cart?</span>
            <button
              type="button"
              onClick={async () => {
                setClearOpen(false);
                try {
                  await clear();
                } catch (err) {
                  setFormError(err instanceof Error ? err.message : 'The cart could not be cleared.');
                }
              }}
              className="min-h-[38px] px-3 rounded-xl bg-rose-600 text-white font-bold"
              data-testid="cart-clear-confirm"
            >
              Clear everything
            </button>
            <button
              type="button"
              onClick={() => setClearOpen(false)}
              className="min-h-[38px] px-3 rounded-xl border border-rose-300 font-semibold"
            >
              Keep cart
            </button>
          </div>
        )}

        {cart.itemCount === 0 ? (
          <div
            className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 space-y-3"
            data-testid="cart-empty"
          >
            <Package className="w-7 h-7 mx-auto text-slate-300" />
            Your company cart is empty.
            <div>
              <button
                type="button"
                onClick={onBrowse}
                className="min-h-[42px] px-4 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                Browse the catalogue
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {cart.items.map(item => item.detailsRestricted ? (
              <div key={item.skuId} className="p-3 rounded-xl border border-rose-200 space-y-2" data-testid="cart-item">
                <div className="flex items-center gap-3 text-xs">
                  <Package className="w-6 h-6 text-slate-400" />
                  <div className="flex-1">
                    <div className="font-bold">Unavailable item</div>
                    <div className="text-slate-500">{item.quantity} PCS · Details unavailable</div>
                  </div>
                  <button type="button" disabled={busySku === item.skuId}
                    onClick={() => void remove(item.skuId)}
                    className="w-9 h-9 rounded-lg border border-slate-300 text-rose-600 grid place-items-center disabled:opacity-50"
                    aria-label="Remove unavailable item" data-testid="cart-remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700" data-testid="cart-item-issue">
                  {item.issues.join(' ')}
                </div>
              </div>
            ) : (
              <div
                key={item.skuId}
                className="p-3 rounded-xl border border-slate-200 space-y-2"
                data-testid="cart-item"
                data-sku-code={item.skuCode}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover bg-slate-100"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] text-slate-400">
                      {item.productCode} · {item.skuCode}
                    </div>
                    <div className="font-bold truncate">{item.productTitleEn}</div>
                    <div className="text-slate-500">
                      {item.colorNameEn} · {usdFromCents(item.unitPriceCents)} / pc
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => changeQuantity(item.skuId, -10)}
                      className="w-9 h-9 rounded-lg border border-slate-300 grid place-items-center"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={10}
                      step={1}
                      value={quantities[item.skuId] ?? ''}
                      onChange={event =>
                        setQuantities(prev => ({ ...prev, [item.skuId]: event.target.value }))
                      }
                      className="w-20 h-9 px-2 rounded-lg border border-slate-300 text-center text-xs"
                      data-testid="cart-quantity-input"
                      aria-label={`Quantity for ${item.skuCode}`}
                    />
                    <button
                      type="button"
                      onClick={() => changeQuantity(item.skuId, 10)}
                      className="w-9 h-9 rounded-lg border border-slate-300 grid place-items-center"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busySku === item.skuId}
                      onClick={() => void saveQuantity(item.skuId)}
                      className="h-9 px-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold disabled:opacity-50"
                      data-testid="cart-quantity-save"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={busySku === item.skuId}
                      onClick={() => void remove(item.skuId)}
                      className="w-9 h-9 rounded-lg border border-slate-300 text-rose-600 grid place-items-center disabled:opacity-50"
                      aria-label={`Remove ${item.skuCode}`}
                      data-testid="cart-remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-right w-24">
                    <div className="font-bold">{usdFromCents(item.lineTotalCents)}</div>
                    <div className="text-[10px] text-slate-400">{item.available} PCS available</div>
                  </div>
                </div>
                {item.issues.length > 0 && (
                  <div
                    className="rounded-lg bg-rose-50 border border-rose-200 p-2 text-[11px] text-rose-700 flex items-start gap-1.5"
                    data-testid="cart-item-issue"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{item.issues.join(' ')}</span>
                  </div>
                )}
                {lineErrors[item.skuId] && (
                  <div className="text-[11px] text-rose-700">{lineErrors[item.skuId]}</div>
                )}
              </div>
            ))}
            <div className="flex items-center justify-end gap-3 text-xs pt-1">
              <span className="text-slate-500">Reference total</span>
              <span className="text-base font-extrabold text-[#ff681e]" data-testid="cart-reference-total">
                {usdFromCents(cart.referenceTotalCents)}
              </span>
            </div>
            <p className="text-[10px] text-slate-500">{cart.priceNote}</p>
          </div>
        )}
      </section>

      {cart.itemCount > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-extrabold">Delivery requirements</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold text-slate-700 mb-1">Shipping method</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {SHIPPING_METHODS.map(method => (
                  <button
                    key={method}
                    type="button"
                    data-testid="delivery-method"
                    data-method={method}
                    onClick={() => setDraft(current => ({ ...current, shippingMethod: method }))}
                    className={`min-h-[44px] px-2 rounded-xl border text-xs font-semibold ${
                      draft.shippingMethod === method
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>
            <label className="text-xs font-semibold text-slate-700">
              Destination country (ISO alpha-3)
              <input
                value={draft.destinationCountryAlpha3}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    destinationCountryAlpha3: event.target.value.toUpperCase(),
                  }))
                }
                maxLength={3}
                placeholder="e.g. USA"
                className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-300 text-sm font-mono uppercase"
                data-testid="delivery-country"
              />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Expected ship date
              <input
                type="date"
                value={draft.expectedShipDate}
                onChange={event =>
                  setDraft(current => ({ ...current, expectedShipDate: event.target.value }))
                }
                className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
                data-testid="delivery-date"
              />
            </label>
            <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
              Packing requirements and notes
              <textarea
                value={draft.shippingRequirements}
                onChange={event =>
                  setDraft(current => ({ ...current, shippingRequirements: event.target.value }))
                }
                rows={3}
                maxLength={1000}
                placeholder="Packing, labelling or pallet requirements. Do not enter names, phone numbers, emails or street addresses."
                className={`mt-1 w-full p-3 rounded-xl border text-sm ${
                  privacy.hasViolation ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                }`}
                data-testid="delivery-requirements"
              />
            </label>
          </div>
          {privacy.hasViolation ? (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-[11px] text-rose-700 flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {privacy.message}
            </div>
          ) : (
            <div className="text-[10px] text-emerald-700 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> No contact details or street address detected.
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="text-xs text-slate-500">
              {totalPieces} PCS · reference quote only, pending sales confirmation.
            </div>
            <button
              type="button"
              onClick={openConfirm}
              className="min-h-[46px] px-5 rounded-xl bg-[#ff681e] text-white text-sm font-extrabold"
              data-testid="cart-submit-open"
            >
              Review and submit order
            </button>
          </div>
        </section>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
          role="dialog"
          aria-modal="true"
          data-testid="cart-submit-confirm"
        >
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            <h3 className="text-base font-extrabold">Confirm order submission</h3>
            <p className="text-xs text-slate-600">
              {cart.itemCount} lines · {totalPieces} PCS · reference total{' '}
              <strong>{usdFromCents(cart.referenceTotalCents)}</strong>
            </p>
            <p className="text-[11px] text-slate-500">
              This creates a PENDING_CONFIRMATION order. It does not confirm the order, reserve
              stock, record payment or arrange shipment. Sales will verify the final price.
            </p>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
              {draft.shippingMethod} · {draft.destinationCountryAlpha3} ·{' '}
              {draft.expectedShipDate}
              {draft.shippingRequirements ? ` · ${draft.shippingRequirements}` : ''}
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void confirmSubmit()}
                disabled={submitting}
                className="min-h-[42px] px-4 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
                data-testid="cart-submit-confirm-button"
              >
                {submitting ? 'Submitting…' : 'Submit order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
