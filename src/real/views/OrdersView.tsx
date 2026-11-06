import React, { useEffect, useState } from 'react';
import { ClipboardList, RefreshCw, ShieldAlert } from 'lucide-react';
import { AuthApiError } from '../../auth/api';
import {
  cancelCustomerOrder,
  getAdminOrder,
  getCustomerOrder,
  getSalesOrder,
  listAdminOrders,
  listCustomerOrders,
  listSalesOrders,
  modifyOrderLines,
} from '../api';
import { usdFromCents } from '../cart';
import type { CustomerOrderDto, InternalOrderDto } from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';

type OrderView = CustomerOrderDto | InternalOrderDto;

function isInternal(order: OrderView): order is InternalOrderDto {
  return 'company' in order;
}

function statusClass(status: string): string {
  if (status === 'PENDING_CONFIRMATION') {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  if (status === 'CANCELLED') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'CONFIRMED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function pieces(order: OrderView): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export const OrdersView: React.FC<{ scope: 'customer' | 'sales' | 'admin' }> = ({ scope }) => {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lineDrafts, setLineDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = async (): Promise<void> => {
    setError('');
    const items =
      scope === 'customer'
        ? await listCustomerOrders()
        : scope === 'sales'
          ? await listSalesOrders()
          : await listAdminOrders();
    setOrders(items);
  };

  const load = () => {
    setLoading(true);
    setError('');
    loadList()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [scope]);

  const loadDetail = async (id: string): Promise<void> => {
    setSelectedId(id);
    setDetailLoading(true);
    setActionError('');
    setCancelOpen(false);
    try {
      const item =
        scope === 'customer'
          ? await getCustomerOrder(id)
          : scope === 'sales'
            ? await getSalesOrder(id)
            : await getAdminOrder(id);
      setDetail(item);
      setLineDrafts(
        Object.fromEntries(item.lines.map(line => [line.skuId, String(line.quantity)]))
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The order could not be loaded.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshAll = async (id?: string) => {
    await loadList();
    if (id) await loadDetail(id);
  };

  const saveLines = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const changed = detail.lines
        .map(line => ({ skuId: line.skuId, quantity: Number(lineDrafts[line.skuId]) }))
        .filter((line, index) => line.quantity !== detail.lines[index].quantity);
      if (!changed.length) {
        setActionError('Change at least one quantity first.');
        return;
      }
      const updated = await modifyOrderLines(detail.id, detail.revision, changed);
      setDetail(updated);
      setLineDrafts(
        Object.fromEntries(updated.lines.map(line => [line.skuId, String(line.quantity)]))
      );
      setNotice('Order quantities updated. Reference total recalculated.');
      await loadList();
    } catch (err) {
      setActionError(
        err instanceof AuthApiError ? err.message : err instanceof Error ? err.message : 'Update failed.'
      );
      await refreshAll(detail.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const updated = await cancelCustomerOrder(
        detail.id,
        detail.revision,
        cancelReason.trim() || 'Customer cancelled before confirmation.'
      );
      setDetail(updated);
      setCancelOpen(false);
      setNotice('Order cancelled.');
      await loadList();
    } catch (err) {
      setActionError(
        err instanceof AuthApiError ? err.message : err instanceof Error ? err.message : 'Cancellation failed.'
      );
      await refreshAll(detail.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading orders… / 正在加载订单…" />;
  if (error) return <ErrorBlock message={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList className="w-5 h-5 text-[#ff681e]" />
          <h2 className="text-base font-extrabold">
            {scope === 'customer'
              ? 'My company orders'
              : scope === 'sales'
                ? '待确认订单 / Pending orders'
                : '订单监督 / Order supervision'}
          </h2>
          <span className="text-[11px] text-slate-500">
            {scope === 'customer'
              ? 'All accounts of your company can see these orders.'
              : scope === 'sales'
                ? 'Only customers assigned to you.'
                : 'Read-only supervision of all customer orders.'}
          </span>
          <button
            type="button"
            onClick={() => void refreshAll(selectedId ?? undefined)}
            className="ml-auto min-h-[38px] px-3 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}
      {actionError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {actionError}
        </div>
      )}

      {!orders.length ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
          No orders yet. / 暂无订单。
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(order => (
            <button
              key={order.id}
              type="button"
              onClick={() => void loadDetail(order.id)}
              data-testid={scope === 'customer' ? 'customer-order-card' : 'internal-order-card'}
              data-order-no={order.orderNo}
              className={`w-full text-left bg-white border rounded-2xl p-4 transition-colors ${
                selectedId === order.id
                  ? 'border-[#ff681e]'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold">{order.orderNo}</span>
                <span
                  className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusClass(order.status)}`}
                >
                  {order.statusLabel}
                </span>
                {isInternal(order) && (
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                    {order.company.customerCode} · {order.company.shortName}
                  </span>
                )}
                <span className="ml-auto text-slate-500">{formatDate(order.submittedAt)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span>
                  {order.lines.length} lines · {pieces(order)} PCS
                </span>
                <span>Reference {usdFromCents(order.referenceTotalCents)}</span>
                <span>
                  {order.shippingMethod} · {order.destinationCountryAlpha3} ·{' '}
                  {order.expectedShipDate}
                </span>
                {isInternal(order) && <span>Buyer {order.submittedByUsername}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {(detail || detailLoading) && (
        <section
          className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4"
          data-testid="order-detail"
        >
          {detailLoading || !detail ? (
            <LoadingBlock label="Loading order detail…" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <div className="text-[10px] font-mono text-slate-400">Order</div>
                  <div className="text-lg font-extrabold font-mono">{detail.orderNo}</div>
                </div>
                <span
                  className={`px-2 py-1 rounded-full border text-[10px] font-bold ${statusClass(detail.status)}`}
                >
                  {detail.statusLabel}
                </span>
                <span className="text-[11px] text-slate-500">
                  Revision {detail.revision} · updated {formatDate(detail.updatedAt)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setDetail(null);
                  }}
                  className="ml-auto min-h-[36px] px-3 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  Close
                </button>
              </div>

              {isInternal(detail) && (
                <div className="grid sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-slate-400">Customer company</div>
                    <div className="font-semibold">
                      {detail.company.customerCode} · {detail.company.shortName}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-slate-400">Submitted by</div>
                    <div className="font-mono font-semibold">{detail.submittedByUsername}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-slate-400">Assigned salesperson</div>
                    <div className="font-mono text-[11px] break-all">
                      {detail.assignedSalesUserId ?? 'Unassigned'}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {detail.lines.map(line => (
                  <div
                    key={line.id}
                    className="p-3 rounded-xl border border-slate-200 flex flex-wrap items-center gap-2 text-xs"
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-slate-300"
                      style={{ backgroundColor: line.colorHex }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-slate-400">
                        {line.productCode} · {line.skuCode}
                      </div>
                      <div className="font-semibold truncate">
                        {line.productTitleEn} · {line.colorNameEn}
                      </div>
                    </div>
                    {scope === 'customer' && detail.status === 'PENDING_CONFIRMATION' ? (
                      <label className="text-[11px] text-slate-500">
                        Qty
                        <input
                          type="number"
                          min={10}
                          value={lineDrafts[line.skuId] ?? ''}
                          onChange={event =>
                            setLineDrafts(prev => ({ ...prev, [line.skuId]: event.target.value }))
                          }
                          className="ml-1 w-20 h-9 px-2 rounded-lg border border-slate-300 text-center"
                          data-testid="order-line-qty"
                          aria-label={`Quantity for ${line.skuCode}`}
                        />
                      </label>
                    ) : (
                      <span className="font-semibold">{line.quantity} PCS</span>
                    )}
                    <span className="w-24 text-right">
                      <div className="font-bold">{usdFromCents(line.lineReferenceCents)}</div>
                      <div className="text-[10px] text-slate-400">
                        {usdFromCents(line.referenceUnitPriceCents)} / pc
                      </div>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-end gap-3 text-xs pt-1">
                  <span className="text-slate-500">Reference total</span>
                  <span className="text-base font-extrabold text-[#ff681e]">
                    {usdFromCents(detail.referenceTotalCents)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500">{detail.priceNote}</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-400">Delivery</div>
                  <div className="font-semibold">
                    {detail.shippingMethod} · {detail.destinationCountryAlpha3} · expected ship{' '}
                    {detail.expectedShipDate}
                  </div>
                  {detail.shippingRequirements && (
                    <div className="text-slate-600 mt-1">{detail.shippingRequirements}</div>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-400">Status note</div>
                  <div className="text-slate-600">{detail.customerVisibleNote}</div>
                  {detail.cancelReason && (
                    <div className="text-rose-700 mt-1">Cancellation: {detail.cancelReason}</div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">History / 历史</div>
                <div className="space-y-1">
                  {detail.history.map((event, index) => (
                    <div
                      key={`${event.eventType}-${index}`}
                      className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex flex-wrap gap-2"
                    >
                      <span className="font-semibold">{event.eventType}</span>
                      <span>{event.reason}</span>
                      {'actorLabel' in event && (
                        <span className="text-slate-400">by {event.actorLabel}</span>
                      )}
                      <span className="ml-auto text-slate-400">{formatDate(event.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {scope === 'customer' && detail.status === 'PENDING_CONFIRMATION' && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveLines()}
                    className="min-h-[42px] px-4 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
                    data-testid="order-modify-save"
                  >
                    Save quantity changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    className="min-h-[42px] px-4 rounded-xl border border-rose-300 text-rose-700 text-xs font-bold"
                    data-testid="order-cancel-open"
                  >
                    Cancel order
                  </button>
                  <span className="text-[10px] text-slate-500 self-center">
                    Only pending-confirmation orders can be changed or cancelled.
                  </span>
                </div>
              )}

              {scope === 'customer' && cancelOpen && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
                  <div className="text-xs font-semibold text-rose-800">
                    Cancel this pending order? This cannot be undone.
                  </div>
                  <input
                    value={cancelReason}
                    onChange={event => setCancelReason(event.target.value)}
                    maxLength={500}
                    placeholder="Reason (optional, max 500 characters)"
                    className="w-full h-10 px-3 rounded-xl border border-rose-200 text-xs"
                    data-testid="order-cancel-reason"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void confirmCancel()}
                      className="min-h-[40px] px-4 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-50"
                      data-testid="order-cancel-confirm"
                    >
                      Confirm cancellation
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelOpen(false)}
                      className="min-h-[40px] px-4 rounded-xl border border-rose-300 text-xs font-semibold"
                    >
                      Keep order
                    </button>
                  </div>
                </div>
              )}

              {scope === 'sales' && detail.status === 'PENDING_CONFIRMATION' && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled
                    data-testid="sales-confirm-disabled"
                    className="min-h-[42px] px-4 rounded-xl bg-slate-200 text-slate-500 text-xs font-bold cursor-not-allowed"
                  >
                    Confirm order — available in Phase 4B-05
                  </button>
                  <span className="text-[10px] text-slate-500">
                    Confirmation, final pricing and stock reservation are not implemented in this phase.
                  </span>
                </div>
              )}

              {scope === 'admin' && (
                <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  Administrator supervision is read-only. Sales confirmation requires the sales write
                  workflow in Phase 4B-05.
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
};
