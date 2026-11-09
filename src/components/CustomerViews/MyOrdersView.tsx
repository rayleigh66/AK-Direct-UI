/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  customerOrderLineColor,
  customerOrderLineTitle,
  customerStatus,
} from '../../utils/customerDisplay';
import { Order, OrderStatus } from '../../types';
import { SelectAllOnFocusInput } from '../ui/SelectAllOnFocusInput';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  XCircle,
  Truck,
  RotateCcw,
  FileCheck,
  Building,
  User,
} from 'lucide-react';

export const MyOrdersView: React.FC = () => {
  const { orders, products, currentCompany, customerCancelOrder, customerRequestChange } = useApp();

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [cancelModalOrder, setCancelModalOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [changeModalOrder, setChangeModalOrder] = useState<Order | null>(null);
  const [modifyLines, setModifyLines] = useState<{ [skuId: string]: number }>({});
  const [actionFeedback, setActionFeedback] = useState<string>('');

  // Filter orders strictly by customer company (PRD D02 / D28 - company level sharing!)
  const myCompanyOrders = orders.filter(o => o.company_id === currentCompany?.id);

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'PENDING_CONFIRMATION':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#fff1e8] text-[#db5b19] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff681e]" />
            <span>Pending confirmation</span>
          </span>
        );
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#eaf7f0] text-[#198364] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2aab77]" />
            <span>Confirmed · stock reserved (72h)</span>
          </span>
        );
      case 'PAYMENT_RECORDED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#eaf7f0] text-[#198364] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2aab77]" />
            <span>Payment received</span>
          </span>
        );
      case 'PREPARING_SHIPMENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#f0f0ef] text-[#212121] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#222]" />
            <span>Preparing shipment</span>
          </span>
        );
      case 'SHIPPED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#eaf7f0] text-[#198364] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2aab77]" />
            <span>Shipped</span>
          </span>
        );
      case 'DELIVERED':
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#f0f0ef] text-[#858585] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#999]" />
            <span>Delivered</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#fff0ed] text-[#ce4530] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d75339]" />
            <span>Cancelled</span>
          </span>
        );
      case 'RESERVATION_EXPIRED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#f0f0ef] text-[#858585] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#999]" />
            <span>Reservation expired</span>
          </span>
        );
    }
  };

  const handleCancelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalOrder) return;
    const res = customerCancelOrder(cancelModalOrder.id, cancelReason);
    setActionFeedback(res.message);
    setCancelModalOrder(null);
    setCancelReason('');
    setTimeout(() => setActionFeedback(''), 3000);
  };

  const openModifyModal = (order: Order) => {
    const initLines: { [skuId: string]: number } = {};
    order.lines.forEach(l => {
      initLines[l.sku_id] = l.quantity;
    });
    setModifyLines(initLines);
    setChangeModalOrder(order);
  };

  const handleModifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeModalOrder) return;

    const modifiedArr = Object.entries(modifyLines).map(([sku_id, new_qty]) => ({
      sku_id,
      new_qty,
    }));

    const res = customerRequestChange(
      changeModalOrder.id,
      'Customer requested a quantity change',
      modifiedArr
    );

    setActionFeedback(res.message);
    setChangeModalOrder(null);
    setTimeout(() => setActionFeedback(''), 3000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-24">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">My orders</h1>
          <p className="text-xs text-slate-500">
            Company: <span className="font-semibold text-slate-700">{currentCompany?.short_name}</span> ({currentCompany?.customer_code}) · Orders from all accounts in your company are shared.
          </p>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-3 bg-slate-900 text-white text-xs rounded-xl flex items-center justify-between animate-in fade-in">
          <span>{actionFeedback}</span>
          <button onClick={() => setActionFeedback('')} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {myCompanyOrders.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h2 className="text-sm font-bold text-slate-700">No order requests yet</h2>
          <p className="text-xs text-slate-400 mt-1">Choose a SKU in the catalog to submit your first order request.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {myCompanyOrders.map(order => {
            const isExpanded = expandedOrderId === order.id;
            const totalPcs = order.lines.reduce((s, l) => s + l.quantity, 0);

            return (
              <div
                key={order.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all"
              >
                {/* Order Summary Row */}
                <div
                  onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                  className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        {order.order_no}
                      </span>
                      {getStatusBadge(order.status)}
                      {order.change_request && order.change_request.status === 'pending' && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                          Change under review ({order.change_request.request_type === 'cancel_order' ? 'cancel request' : 'quantity change'})
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>Submitted: {order.created_at}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>Account: <strong className="text-slate-700">{order.created_by_username}</strong></span>
                      </span>
                      <span>·</span>
                      <span>Destination: <strong className="text-slate-700">{order.destination_country_alpha3}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                    <div className="text-left md:text-right">
                      <div className="text-xs text-slate-400">Total PCS</div>
                      <div className="font-mono font-bold text-xs text-slate-800">
                        {totalPcs} PCS
                      </div>
                    </div>

                    <div className="text-left md:text-right">
                      <div className="text-xs text-slate-400">Reference total</div>
                      <div className="font-mono font-extrabold text-sm text-slate-900 tabular-nums">
                        USD ${order.total_confirmed_usd ? order.total_confirmed_usd.toFixed(2) : order.total_quoted_usd.toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="p-1 text-slate-400 hover:text-slate-700"
                        aria-label={isExpanded ? 'Collapse order details' : 'Expand order details'}
                      >
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="p-5 border-t border-slate-100 bg-slate-50/50 space-y-6 animate-in fade-in duration-150">
                    {/* Status & Lifecycle Timeline */}
                    <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
                      <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                        <span>Order progress</span>
                        {order.reservation_expires_at && order.status === 'CONFIRMED' && (
                          <span className="text-[11px] text-amber-700 font-medium">
                            Reservation expires: {order.reservation_expires_at.slice(0, 16).replace('T', ' ')} UTC
                          </span>
                        )}
                      </div>

                      {/* Interactive Step Timeline */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-xs">
                        {[
                          { title: '1. Request sent', done: true, sub: 'No instant stock lock' },
                          {
                            title: '2. Sales review',
                            done: ['CONFIRMED', 'PAYMENT_RECORDED', 'PREPARING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: 'Demo reservation 72h',
                          },
                          {
                            title: '3. Payment',
                            done: ['PAYMENT_RECORDED', 'PREPARING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: order.payment_amount_usd ? `Received $${order.payment_amount_usd}` : 'Wire verification',
                          },
                          {
                            title: '4. Whole-order shipment',
                            done: ['SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: order.carrier ? `${order.carrier}` : 'Dispatch',
                          },
                          {
                            title: '5. Delivered',
                            done: ['DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: 'Completed',
                          },
                        ].map((step, idx) => (
                          <div
                            key={idx}
                            className={`p-2.5 rounded-lg border text-left ${
                              step.done
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-950 font-medium'
                                : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              {step.done ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />
                              )}
                              <span className="font-semibold text-xs">{step.title}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">{step.sub}</div>
                          </div>
                        ))}
                      </div>

                      {/* Customer Visible Note */}
                      {order.customer_visible_note && (
                        <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-700 leading-relaxed border border-slate-100">
                          <strong>Sales update:</strong> {order.customer_visible_note}
                        </div>
                      )}
                    </div>

                    {/* Order Lines Table */}
                    <div className="sm:hidden space-y-2">
                      {order.lines.map((l, i) => (
                        <div key={i} className="p-3 bg-white rounded-xl border border-slate-200">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-xs text-slate-900">{l.sku_code}</div>
                              <div className="text-[11px] text-slate-500 truncate">{customerOrderLineTitle(l, products)}</div>
                              <div className="text-[11px] text-slate-500">{customerOrderLineColor(l, products)}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono font-bold text-xs text-slate-900">${l.line_subtotal.toFixed(2)}</div>
                              <div className="text-[10px] text-slate-400">{l.quantity} PCS × ${l.quoted_unit_price.toFixed(2)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto hidden sm:block">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold uppercase text-[10px]">
                          <tr>
                            <th className="p-3 pl-4">SKU / Product</th>
                            <th className="p-3">Colour</th>
                            <th className="p-3 text-center">Qty (PCS)</th>
                            <th className="p-3 text-right">Unit price</th>
                            <th className="p-3 pr-4 text-right">Line total (USD)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {order.lines.map((l, i) => (
                            <tr key={i} className="hover:bg-slate-50/50">
                              <td className="p-3 pl-4">
                                <div className="font-mono font-bold text-slate-900">{l.sku_code}</div>
                                <div className="text-[11px] text-slate-500">{customerOrderLineTitle(l, products)}</div>
                              </td>
                              <td className="p-3 text-slate-600">{customerOrderLineColor(l, products)}</td>
                              <td className="p-3 text-center font-mono font-bold text-slate-800">
                                {l.quantity}
                              </td>
                              <td className="p-3 text-right font-mono tabular-nums text-slate-700">
                                ${l.quoted_unit_price.toFixed(2)}
                              </td>
                              <td className="p-3 pr-4 text-right font-mono font-bold tabular-nums text-slate-900">
                                ${l.line_subtotal.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Logistics & Tracking info */}
                    {order.tracking_no && (
                      <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 text-xs space-y-2">
                        <div className="font-bold text-emerald-950 flex items-center gap-2">
                          <Truck className="w-4 h-4 text-emerald-700" />
                          <span>Shipment tracking</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-700">
                          <div>
                            <span className="text-slate-400 block text-[10px]">Carrier:</span>
                            <span className="font-semibold">{order.carrier}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Tracking number:</span>
                            <span className="font-mono font-bold text-emerald-800">{order.tracking_no}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Actual ship date:</span>
                            <span>{order.actual_ship_date}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Estimated arrival:</span>
                            <span>{order.estimated_delivery_date}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Controls for Customer based on PRD 6.2 */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
                      <div className="text-xs text-slate-500">
                        Shipping: <strong className="text-slate-800">{order.shipping_method}</strong> · Packing: {order.shipping_requirements || 'No special requirements'}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* If PENDING_CONFIRMATION: Can directly edit or cancel */}
                        {order.status === 'PENDING_CONFIRMATION' && (
                          <>
                            <button
                              onClick={() => openModifyModal(order)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Edit quantities
                            </button>
                            <button
                              onClick={() => {
                                setCancelModalOrder(order);
                                setCancelReason('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold hover:bg-rose-100"
                            >
                              Cancel request
                            </button>
                          </>
                        )}

                        {/* If CONFIRMED: Must submit request for sales approval */}
                        {order.status === 'CONFIRMED' && (!order.change_request || order.change_request.status !== 'pending') && (
                          <>
                            <button
                              onClick={() => openModifyModal(order)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Request quantity change
                            </button>
                            <button
                              onClick={() => {
                                setCancelModalOrder(order);
                                setCancelReason('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold hover:bg-amber-100"
                            >
                              Request cancellation
                            </button>
                          </>
                        )}

                        {/* If PAYMENT_RECORDED or later: Non-cancellable */}
                        {['PAYMENT_RECORDED', 'PREPARING_SHIPMENT', 'SHIPPED'].includes(order.status) && (
                          <div className="text-[11px] text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">
                            Payment received. The order is locked for fulfillment. Contact your sales representative for after-sales support.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cancel Order Modal */}
      {cancelModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400" />
                <h3 className="text-sm font-bold">
                  {cancelModalOrder.status === 'PENDING_CONFIRMATION'
                    ? 'Cancel pending order request'
                    : 'Request cancellation (sales review required)'}
                </h3>
              </div>
              <button onClick={() => setCancelModalOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCancelSubmit} className="p-5 space-y-4">
              <p className="text-xs text-slate-600">
                Order: <strong className="font-mono text-slate-900">{cancelModalOrder.order_no}</strong>
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for cancellation (required)
                </label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder="Tell us why (e.g. wrong specification, lead time)..."
                  className="w-full p-3 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCancelModalOrder(null)}
                  className="flex-1 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
                >
                  Submit request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modify Order Quantity Modal */}
      {changeModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold">
                  {changeModalOrder.status === 'PENDING_CONFIRMATION'
                    ? 'Edit order quantities'
                    : 'Request quantity change'}
                </h3>
              </div>
              <button onClick={() => setChangeModalOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleModifySubmit} className="p-5 space-y-4">
              <p className="text-xs text-slate-500">
                Order: <strong className="font-mono text-slate-900">{changeModalOrder.order_no}</strong> · MOQ: 10 PCS
              </p>

              <div className="space-y-3 max-h-60 overflow-y-auto">
                {changeModalOrder.lines.map(l => (
                  <div key={l.sku_id} className="p-3 bg-slate-50 rounded-xl flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-mono font-bold text-slate-900">{l.sku_code}</div>
                      <div className="text-[11px] text-slate-500">{customerOrderLineTitle(l, products)} ({customerOrderLineColor(l, products)})</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">New qty:</span>
                      <SelectAllOnFocusInput
                        type="number"
                        min={10}
                        value={modifyLines[l.sku_id] || l.quantity}
                        onChange={e => {
                          const val = parseInt(e.target.value) || 10;
                          setModifyLines(prev => ({ ...prev, [l.sku_id]: val }));
                        }}
                        className="w-16 h-8 text-center font-mono font-bold text-xs border border-slate-300 rounded-lg bg-white"
                        required
                      />
                      <span className="text-[11px] text-slate-500">PCS</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setChangeModalOrder(null)}
                  className="flex-1 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  Save change
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
