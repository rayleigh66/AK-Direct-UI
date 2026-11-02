/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Order, OrderStatus } from '../../types';
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
  const { orders, currentCompany, customerCancelOrder, customerRequestChange, openDrawer } = useApp();

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
            <span>待业务员确认</span>
          </span>
        );
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#eaf7f0] text-[#198364] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2aab77]" />
            <span>已确认·库存预占中 (72h)</span>
          </span>
        );
      case 'PAYMENT_RECORDED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#eaf7f0] text-[#198364] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2aab77]" />
            <span>货款已核对入账</span>
          </span>
        );
      case 'PREPARING_SHIPMENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#f0f0ef] text-[#212121] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#222]" />
            <span>备货打带中</span>
          </span>
        );
      case 'SHIPPED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#eaf7f0] text-[#198364] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2aab77]" />
            <span>整单已发货</span>
          </span>
        );
      case 'DELIVERED':
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#f0f0ef] text-[#858585] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#999]" />
            <span>已签收送达</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#fff0ed] text-[#ce4530] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d75339]" />
            <span>订单已取消</span>
          </span>
        );
      case 'RESERVATION_EXPIRED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#f0f0ef] text-[#858585] text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#999]" />
            <span>预占已超期释放</span>
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
      '客户申请调整订购数量',
      modifiedArr
    );

    setActionFeedback(res.message);
    setChangeModalOrder(null);
    setTimeout(() => setActionFeedback(''), 3000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">我的订单 (My Orders)</h1>
          <p className="text-xs text-slate-500">
            公司: <span className="font-semibold text-slate-700">{currentCompany?.short_name}</span> ({currentCompany?.customer_code}) · 共享同公司所有账号提交的订购单 (PRD D02)
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
          <h2 className="text-sm font-bold text-slate-700">暂无订购单记录</h2>
          <p className="text-xs text-slate-400 mt-1">您可在现货商城选购 SKU 并提交订购申请。</p>
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
                          变更审核中 ({order.change_request.request_type === 'cancel_order' ? '申请取消' : '申请改单'})
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>提交时间: {order.created_at}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>下单账号: <strong className="text-slate-700">{order.created_by_username}</strong></span>
                      </span>
                      <span>·</span>
                      <span>目的国: <strong className="text-slate-700">{order.destination_country_alpha3}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                    <div className="text-left md:text-right">
                      <div className="text-xs text-slate-400">订购总数</div>
                      <div className="font-mono font-bold text-xs text-slate-800">
                        {totalPcs} PCS
                      </div>
                    </div>

                    <div className="text-left md:text-right">
                      <div className="text-xs text-slate-400">参考总金额</div>
                      <div className="font-mono font-extrabold text-sm text-slate-900 tabular-nums">
                        USD ${order.total_confirmed_usd ? order.total_confirmed_usd.toFixed(2) : order.total_quoted_usd.toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openDrawer('order', order.id);
                        }}
                        className="px-2.5 py-1 text-[11px] font-bold text-[#ff681e] hover:bg-[#fff1e8] rounded-[6px] transition-colors"
                        title="打开侧滑抽屉详情"
                      >
                        详情抽屉 →
                      </button>

                      <button className="p-1 text-slate-400 hover:text-slate-700">
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
                        <span>订单生命周期综合进度 (Comprehensive Timeline)</span>
                        {order.reservation_expires_at && order.status === 'CONFIRMED' && (
                          <span className="text-[11px] text-amber-700 font-medium">
                            库存预占截止: {order.reservation_expires_at.slice(0, 16).replace('T', ' ')} UTC
                          </span>
                        )}
                      </div>

                      {/* Interactive Step Timeline */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-xs">
                        {[
                          { title: '1. 提交申请', done: true, sub: '无需即时锁库' },
                          {
                            title: '2. 业务员确认',
                            done: ['CONFIRMED', 'PAYMENT_RECORDED', 'PREPARING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: '原子预占 72h',
                          },
                          {
                            title: '3. 付款入账',
                            done: ['PAYMENT_RECORDED', 'PREPARING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: order.payment_amount_usd ? `实收 $${order.payment_amount_usd}` : '电汇核验',
                          },
                          {
                            title: '4. 整单发货',
                            done: ['SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: order.carrier ? `${order.carrier}` : '整单出库',
                          },
                          {
                            title: '5. 签收完成',
                            done: ['DELIVERED', 'COMPLETED'].includes(order.status),
                            sub: '履约闭环',
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
                          <strong>业务员反馈说明:</strong> {order.customer_visible_note}
                        </div>
                      )}
                    </div>

                    {/* Order Lines Table */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold uppercase text-[10px]">
                          <tr>
                            <th className="p-3 pl-4">SKU / 款号</th>
                            <th className="p-3">颜色规格</th>
                            <th className="p-3 text-center">订购数量 (PCS)</th>
                            <th className="p-3 text-right">参考单价</th>
                            <th className="p-3 pr-4 text-right">行小计 (USD)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {order.lines.map((l, i) => (
                            <tr key={i} className="hover:bg-slate-50/50">
                              <td className="p-3 pl-4">
                                <div className="font-mono font-bold text-slate-900">{l.sku_code}</div>
                                <div className="text-[11px] text-slate-500">{l.product_title}</div>
                              </td>
                              <td className="p-3 text-slate-600">{l.color_name}</td>
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
                          <span>整单物流配送进度 (Whole Order Shipment)</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-700">
                          <div>
                            <span className="text-slate-400 block text-[10px]">承运商 (Carrier):</span>
                            <span className="font-semibold">{order.carrier}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">国际运单号 (Tracking):</span>
                            <span className="font-mono font-bold text-emerald-800">{order.tracking_no}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">实际发货日期:</span>
                            <span>{order.actual_ship_date}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">预计到达日期:</span>
                            <span>{order.estimated_delivery_date}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Controls for Customer based on PRD 6.2 */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
                      <div className="text-xs text-slate-500">
                        运输方式: <strong className="text-slate-800">{order.shipping_method}</strong> · 包装要求: {order.shipping_requirements || '无特殊要求'}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* If PENDING_CONFIRMATION: Can directly edit or cancel */}
                        {order.status === 'PENDING_CONFIRMATION' && (
                          <>
                            <button
                              onClick={() => openModifyModal(order)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              修改数量 (Direct Edit)
                            </button>
                            <button
                              onClick={() => {
                                setCancelModalOrder(order);
                                setCancelReason('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold hover:bg-rose-100"
                            >
                              取消申请 (Cancel)
                            </button>
                          </>
                        )}

                        {/* If CONFIRMED: Must submit request for sales approval */}
                        {order.status === 'CONFIRMED' && !order.change_request && (
                          <>
                            <button
                              onClick={() => openModifyModal(order)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              申请改单 (Request Change)
                            </button>
                            <button
                              onClick={() => {
                                setCancelModalOrder(order);
                                setCancelReason('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold hover:bg-amber-100"
                            >
                              申请取消 (Request Cancel)
                            </button>
                          </>
                        )}

                        {/* If PAYMENT_RECORDED or later: Non-cancellable */}
                        {['PAYMENT_RECORDED', 'PREPARING_SHIPMENT', 'SHIPPED'].includes(order.status) && (
                          <div className="text-[11px] text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">
                            已付款入账，已锁定生产/发货通道。如遇特殊售后请线下联系业务员。
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
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400" />
                <h3 className="text-sm font-bold">
                  {cancelModalOrder.status === 'PENDING_CONFIRMATION'
                    ? '确认取消未核准订购申请'
                    : '申请取消已确认订单 (需业务员审核)'}
                </h3>
              </div>
              <button onClick={() => setCancelModalOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCancelSubmit} className="p-5 space-y-4">
              <p className="text-xs text-slate-600">
                单号: <strong className="font-mono text-slate-900">{cancelModalOrder.order_no}</strong>
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  取消原因说明 (必填)
                </label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder="请告知取消原因（如规格选错、交期不符等）..."
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
                  返回
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
                >
                  确认提交
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modify Order Quantity Modal */}
      {changeModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold">
                  {changeModalOrder.status === 'PENDING_CONFIRMATION'
                    ? '修改订购数量'
                    : '申请修改已确认订单数量'}
                </h3>
              </div>
              <button onClick={() => setChangeModalOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleModifySubmit} className="p-5 space-y-4">
              <p className="text-xs text-slate-500">
                单号: <strong className="font-mono text-slate-900">{changeModalOrder.order_no}</strong> · 起订量 MOQ: 10 PCS
              </p>

              <div className="space-y-3 max-h-60 overflow-y-auto">
                {changeModalOrder.lines.map(l => (
                  <div key={l.sku_id} className="p-3 bg-slate-50 rounded-xl flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-mono font-bold text-slate-900">{l.sku_code}</div>
                      <div className="text-[11px] text-slate-500">{l.product_title} ({l.color_name})</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">调整为:</span>
                      <input
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
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  保存并生效
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
