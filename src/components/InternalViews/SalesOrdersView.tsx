/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Order, OrderStatus } from '../../types';
import { calculateSKUAvailableStock } from '../../utils/rules';
import {
  CheckCircle2,
  Clock,
  Truck,
  FileCheck,
  AlertTriangle,
  RotateCcw,
  Building,
  User,
  ShieldAlert,
  Send,
  DollarSign,
  PackageCheck,
} from 'lucide-react';

export const SalesOrdersView: React.FC = () => {
  const {
    orders,
    inventory,
    companies,
    salesConfirmOrder,
    salesExtendReservation,
    salesReleaseReservation,
    salesRecordPayment,
    salesUpdateShipment,
    salesHandleChangeRequest,
    currentSalesUser,
  } = useApp();

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Payment Recording Modal State
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentReference, setPaymentReference] = useState('');

  // Shipment Recording Modal State
  const [shipmentOrder, setShipmentOrder] = useState<Order | null>(null);
  const [carrier, setCarrier] = useState('DHL Express Worldwide');
  const [trackingNo, setTrackingNo] = useState('');
  const [actualShipDate, setActualShipDate] = useState('2026-11-02');
  const [estimatedDelivery, setEstimatedDelivery] = useState('2026-11-08');
  const [customerVisibleNote, setCustomerVisibleNote] = useState(
    '货物已整单出库并交付承运商，预计 5-7 个工作日到达目的港。'
  );
  const [internalNote, setInternalNote] = useState(
    '已完成提总装车核验，外箱均贴 AOKING 麦头。'
  );

  const [actionMessage, setActionMessage] = useState('');

  const filteredOrders = orders.filter(o => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'pending') return o.status === 'PENDING_CONFIRMATION';
    if (filterStatus === 'confirmed') return o.status === 'CONFIRMED';
    if (filterStatus === 'paid') return o.status === 'PAYMENT_RECORDED';
    if (filterStatus === 'shipped') return o.status === 'SHIPPED';
    if (filterStatus === 'change_requests') return !!o.change_request && o.change_request.status === 'pending';
    return true;
  });

  const handleConfirm = (orderId: string) => {
    const res = salesConfirmOrder(orderId);
    if (res.success) {
      setActionMessage('订单确认成功！已完成整单模拟预占（Demo，非数据库事务），并生成 72 小时预占期与客户邮件草稿。');
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(res.error);
    }
  };

  const handleRecordPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentOrder) return;
    const res = salesRecordPayment(paymentOrder.id, paymentAmount, paymentReference);
    if (res.success) {
      setActionMessage(`付款核验登记成功！USD $${paymentAmount} 已入账并更新客户历史有效采购额。`);
      setPaymentOrder(null);
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(res.error);
    }
  };

  const handleShipmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipmentOrder) return;
    const res = salesUpdateShipment(shipmentOrder.id, {
      carrier,
      trackingNo,
      actualShipDate,
      estimatedDeliveryDate: estimatedDelivery,
      customerVisibleNote,
      internalNote,
    });
    if (!res.success) {
      alert(res.error);
      return;
    }
    setActionMessage('整单发货记录更新成功！原仓库预占库存已扣减出库。');
    setShipmentOrder(null);
    setTimeout(() => setActionMessage(''), 4000);
  };

  const handleRelease = (orderId: string) => {
    const res = salesReleaseReservation(orderId, '未在期限内付款或客户协商释放');
    if (res.success) {
      setActionMessage('预占库存已按原仓库分配释放。');
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(res.error);
    }
  };

  const handleExtend = (orderId: string) => {
    const res = salesExtendReservation(orderId, 48);
    if (res.success) {
      setActionMessage('预占期已延长 48 小时。');
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(res.error);
    }
  };

  const handleChangeRequest = (orderId: string, approve: boolean) => {
    const res = salesHandleChangeRequest(orderId, approve);
    if (res.success) {
      setActionMessage(approve ? '变更申请已核准并完成库存调整。' : '变更申请已驳回，订单与库存不变。');
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(res.error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">业务员订单处理台 (Sales Order Processing)</h1>
          <p className="text-xs text-slate-500">
            负责业务员: <span className="font-semibold text-slate-800">{currentSalesUser.name}</span> ({currentSalesUser.internal_email}) · 支持触屏快速操作
          </p>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-900 text-emerald-100 text-xs rounded-xl flex items-center justify-between animate-in fade-in">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage('')} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: 'all', label: '全部订单' },
          { id: 'pending', label: '待确认核准 (Pending)' },
          { id: 'confirmed', label: '已确认·预占中 (Reserved)' },
          { id: 'paid', label: '已收款待发货 (Paid)' },
          { id: 'shipped', label: '已整单发货 (Shipped)' },
          { id: 'change_requests', label: '客户变更申请 (Changes)' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilterStatus(tab.id)}
            className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-colors ${
              filterStatus === tab.id
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      <div className="space-y-4">
        {filteredOrders.map(order => {
          const comp = companies.find(c => c.id === order.company_id);
          const totalPcs = order.lines.reduce((s, l) => s + l.quantity, 0);

          // Check available stock for each line in pending status
          const hasInsufficientStock = order.lines.some(l => {
            const { totalAvailable } = calculateSKUAvailableStock(l.sku_id, inventory);
            return totalAvailable < l.quantity;
          });

          return (
            <div
              key={order.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm"
            >
              {/* Header Info */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {order.order_no}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                      {order.status}
                    </span>
                    {order.change_request && order.change_request.status === 'pending' && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900">
                        待审批: {order.change_request.request_type === 'cancel_order' ? '申请取消' : '申请改量'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                    <span>客户: <strong className="text-slate-800">{comp?.short_name}</strong> ({comp?.customer_code} / {order.destination_country_alpha3})</span>
                    {comp?.internal_nickname && (
                      <span className="text-indigo-600 font-medium">[{comp.internal_nickname}]</span>
                    )}
                    <span>·</span>
                    <span>下单人: {order.created_by_username}</span>
                    <span>·</span>
                    <span>提交时间: {order.created_at}</span>
                  </div>
                </div>

                <div className="text-left md:text-right">
                  <div className="text-xs text-slate-400">订购总数 / 金额</div>
                  <div className="font-mono font-bold text-sm text-slate-900">
                    {totalPcs} PCS · USD ${order.total_quoted_usd.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] font-semibold">
                    <tr>
                      <th className="p-2.5 pl-3">SKU 编号</th>
                      <th className="p-2.5">商品名称 / 颜色</th>
                      <th className="p-2.5 text-center">需求数量 (MOQ ≥ 10)</th>
                      <th className="p-2.5 text-center">当前可订库存</th>
                      <th className="p-2.5 text-right">参考单价</th>
                      <th className="p-2.5 pr-3 text-right">小计 (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {order.lines.map((l, i) => {
                      const { totalAvailable } = calculateSKUAvailableStock(l.sku_id, inventory);
                      const isEnough = totalAvailable >= l.quantity;
                      return (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="p-2.5 pl-3 font-mono font-bold text-slate-800">{l.sku_code}</td>
                          <td className="p-2.5 text-slate-600">{l.product_title} ({l.color_name})</td>
                          <td className="p-2.5 text-center font-mono font-bold text-slate-900">{l.quantity} PCS</td>
                          <td className="p-2.5 text-center">
                            <span
                              className={`font-mono font-semibold px-2 py-0.5 rounded ${
                                order.status === 'CONFIRMED' || order.status === 'PAYMENT_RECORDED'
                                  ? 'bg-slate-100 text-slate-600'
                                  : isEnough
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700 font-bold'
                              }`}
                            >
                              {totalAvailable} PCS
                            </span>
                          </td>
                          <td className="p-2.5 text-right font-mono text-slate-700">${l.quoted_unit_price.toFixed(2)}</td>
                          <td className="p-2.5 pr-3 text-right font-mono font-bold text-slate-900">${l.line_subtotal.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Change Request Bar (if pending) */}
              {order.change_request && order.change_request.status === 'pending' && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-2">
                  <div className="font-bold text-amber-900 flex items-center justify-between">
                    <span>收到客户变更申请: {order.change_request.request_type === 'cancel_order' ? '申请取消整单' : '申请修改数量'}</span>
                    <span className="text-[10px] text-amber-700">{order.change_request.requested_at}</span>
                  </div>
                  <div className="text-amber-800">申请原因: {order.change_request.reason}</div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleChangeRequest(order.id, true)}
                      className="px-3 py-1 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"
                    >
                      同意申请 (释放/调整预占)
                    </button>
                    <button
                      onClick={() => handleChangeRequest(order.id, false)}
                      className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                    >
                      驳回申请
                    </button>
                  </div>
                </div>
              )}

              {/* Order Notes & Status Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10px]">运输方式与客户要求:</span>
                  <div className="text-slate-700">
                    {order.shipping_method} · 期望交期: {order.expected_ship_date}
                  </div>
                  <div className="text-slate-600 mt-0.5">{order.shipping_requirements}</div>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px]">内部业务备注 (仅业务员与管理员可见):</span>
                  <div className="text-slate-700 font-medium">{order.internal_note || '暂无内部备注'}</div>
                </div>
              </div>

              {/* Action Buttons for Sales Rep based on status */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="text-xs text-slate-500">
                  {order.reservation_expires_at && order.status === 'CONFIRMED' && (
                    <span className="text-sky-800 font-medium">
                      预占有效期截止: {order.reservation_expires_at.slice(0, 16).replace('T', ' ')} UTC (已延期 {order.reservation_extended_count || 0} 次)
                    </span>
                  )}
                  {order.payment_recorded_at && (
                    <span className="text-emerald-700 font-medium">
                      实收已入账: USD ${order.payment_amount_usd} ({order.payment_reference})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Step 1: Confirm Order */}
                  {order.status === 'PENDING_CONFIRMATION' && (
                    <>
                      {hasInsufficientStock ? (
                        <div className="text-xs text-rose-600 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4" />
                          <span>库存不足，无法完成整单模拟预占（PRD 5.2/T08）</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleConfirm(order.id)}
                          className="min-h-[44px] px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-sm"
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>确认订单并整单模拟预占 (72h)</span>
                        </button>
                      )}
                    </>
                  )}

                  {/* Step 2: Confirmed state actions */}
                  {order.status === 'CONFIRMED' && (
                    <>
                      <button
                        onClick={() => handleExtend(order.id)}
                        className="min-h-[44px] px-3 py-2 border border-slate-300 bg-white text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50"
                        title="延长 48 小时预占期"
                      >
                        延期预占 (+48h)
                      </button>

                      <button
                        onClick={() => handleRelease(order.id)}
                        className="min-h-[44px] px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold hover:bg-rose-100"
                      >
                        释放预占库存
                      </button>

                      <button
                        onClick={() => {
                          setPaymentOrder(order);
                          setPaymentAmount(order.total_quoted_usd);
                          setPaymentReference(`WIRE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-CITI`);
                        }}
                        className="min-h-[44px] px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm"
                      >
                        <DollarSign className="w-4 h-4" />
                        <span>登记到账入账 (Record Payment)</span>
                      </button>
                    </>
                  )}

                  {/* Step 3: Paid state actions */}
                  {order.status === 'PAYMENT_RECORDED' && (
                    <button
                      onClick={() => {
                        setShipmentOrder(order);
                        setTrackingNo(`DHL-${Math.floor(1000000000 + Math.random() * 9000000000)}`);
                      }}
                      className="min-h-[44px] px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 flex items-center gap-1.5 shadow-sm"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>录入整单发货物流 (Whole Order Ship)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Record Payment Modal (PRD D17, 7.1, T19) */}
      {paymentOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold">实际付款核对与等级入账登记</h3>
              </div>
              <button onClick={() => setPaymentOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleRecordPaymentSubmit} className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                <div>订单号: <strong className="font-mono">{paymentOrder.order_no}</strong></div>
                <div>应收参考总额: <strong className="font-mono text-slate-900">USD ${paymentOrder.total_quoted_usd.toFixed(2)}</strong></div>
                <div>结算方式: 线下电汇 (T/T Bank Wire Transfer)</div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  实际核验到账金额 (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  银行汇款水单编号 / 索引凭据 (Reference No.)
                </label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={e => setPaymentReference(e.target.value)}
                  placeholder="例如：WIRE-20261101-CITI8819"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl text-[11px] text-emerald-900 leading-relaxed">
                <strong>PRD 7.1 入账联动逻辑:</strong> 登记付款后，订单将锁定为【已付款】不可取消状态；该笔金额将实时计入客户公司的<strong>历史累计有效采购额</strong>，并立即重置未采购计时，恢复或提升客户采购等级！
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentOrder(null)}
                  className="flex-1 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  确认到账并入账
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Shipment Modal (PRD 6.3, D11, T15, T16) */}
      {shipmentOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold">整单发货录入 (Whole Order Shipment)</h3>
              </div>
              <button onClick={() => setShipmentOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleShipmentSubmit} className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                <div>订单号: <strong className="font-mono">{shipmentOrder.order_no}</strong></div>
                <div>目的国家: <strong>{shipmentOrder.destination_country_alpha3}</strong> · 发货原则: 严格整单发货，不支持部分发货 (PRD D11)</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">承运商 (Carrier)</label>
                  <input
                    type="text"
                    value={carrier}
                    onChange={e => setCarrier(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">国际运单号 (Tracking No.)</label>
                  <input
                    type="text"
                    value={trackingNo}
                    onChange={e => setTrackingNo(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">实际发货日期</label>
                  <input
                    type="date"
                    value={actualShipDate}
                    onChange={e => setActualShipDate(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">预计到达日期</label>
                  <input
                    type="date"
                    value={estimatedDelivery}
                    onChange={e => setEstimatedDelivery(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  客户可见备注说明 (Customer Visible Note)
                </label>
                <input
                  type="text"
                  value={customerVisibleNote}
                  onChange={e => setCustomerVisibleNote(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  内部业务备注 (Internal Note — 绝对隔离不向客户展示)
                </label>
                <input
                  type="text"
                  value={internalNote}
                  onChange={e => setInternalNote(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs bg-slate-50"
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShipmentOrder(null)}
                  className="flex-1 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  确认出库发货
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
