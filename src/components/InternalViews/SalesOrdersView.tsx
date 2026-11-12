/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { AccessBoundary } from '../AccessBoundary';
import { Order, OrderStatus } from '../../types';
import { calculateSKUAvailableStock } from '../../utils/rules';
import { shippingMethodLabel, type OrderLanguage } from '../../utils/orderStatus';
import { LanguageToggle } from '../ui/LanguageToggle';
import { OrderStatusBadge } from '../ui/OrderStatusBadge';
import { SelectAllOnFocusInput } from '../ui/SelectAllOnFocusInput';
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
    currentRole,
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
  const [language, setLanguage] = useState<OrderLanguage>('zh');
  const isZh = language === 'zh';
  const text = (zh: string, en: string) => (isZh ? zh : en);
  const actionError = (error?: string) =>
    isZh ? error ?? '操作失败。' : 'The action could not be completed.';

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
    'The entire order has been dispatched with the carrier and is expected to arrive at the destination port in 5–7 business days.'
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
      setActionMessage(
        text(
          '订单确认成功！已完成整单模拟预占（Demo，非数据库事务），并生成 72 小时预占期与客户邮件草稿。',
          'Order confirmed. A 72-hour demo reservation and the customer email draft were created; this is not a database transaction.'
        )
      );
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(actionError(res.error));
    }
  };

  const handleRecordPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentOrder) return;
    const res = salesRecordPayment(paymentOrder.id, paymentAmount, paymentReference);
    if (res.success) {
      setActionMessage(
        text(
          `付款核验登记成功！USD $${paymentAmount} 已入账并更新客户历史有效采购额。`,
          `Payment of USD $${paymentAmount} recorded and the customer's effective spend updated.`
        )
      );
      setPaymentOrder(null);
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(actionError(res.error));
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
      alert(actionError(res.error));
      return;
    }
    setActionMessage(
      text(
        '整单发货记录更新成功！原仓库预占库存已扣减出库。',
        'Whole-order shipment recorded and the reserved stock was consumed.'
      )
    );
    setShipmentOrder(null);
    setTimeout(() => setActionMessage(''), 4000);
  };

  const handleRelease = (orderId: string) => {
    const res = salesReleaseReservation(orderId, '未在期限内付款或客户协商释放');
    if (res.success) {
      setActionMessage(
        text('预占库存已按原仓库分配释放。', 'The reservation was released by warehouse allocation.')
      );
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(actionError(res.error));
    }
  };

  const handleExtend = (orderId: string) => {
    const res = salesExtendReservation(orderId, 48);
    if (res.success) {
      setActionMessage(text('预占期已延长 48 小时。', 'The reservation was extended by 48 hours.'));
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(actionError(res.error));
    }
  };

  const handleChangeRequest = (orderId: string, approve: boolean) => {
    const res = salesHandleChangeRequest(orderId, approve);
    if (res.success) {
      setActionMessage(
        approve
          ? text('变更申请已核准并完成库存调整。', 'Change approved and inventory adjusted.')
          : text('变更申请已驳回，订单与库存不变。', 'Change rejected; order and inventory unchanged.')
      );
      setTimeout(() => setActionMessage(''), 4000);
    } else {
      alert(actionError(res.error));
    }
  };

  if (currentRole === 'customer') {
    return (
      <AccessBoundary
        title={text('业务员订单处理不对客户开放', 'Sales order processing is internal')}
        message={text(
          '客户只能查看自己的订单，不能进入内部订单处理界面。这是前端视图守卫；正式权限必须在后端再次校验。',
          'Customers can only view their own orders. This is a front-end view guard; the backend must re-check permissions.'
        )}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-10">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {text('业务员订单处理台', 'Sales order processing')}
          </h1>
          <p className="text-xs text-slate-500">
            {text('负责业务员', 'Salesperson')}:{' '}
            <span className="font-semibold text-slate-800">{currentSalesUser.name}</span> (
            {currentSalesUser.internal_email}) · {text('支持触屏快速操作', 'touch-friendly actions')}
          </p>
        </div>
        <LanguageToggle
          value={language}
          onChange={setLanguage}
          label={text('订单界面语言', 'Order screen language')}
          testId="sales-order-language"
        />
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
          { id: 'all', label: text('全部订单', 'All orders') },
          { id: 'pending', label: text('待确认', 'Pending') },
          { id: 'confirmed', label: text('已确认·预占中', 'Confirmed / reserved') },
          { id: 'paid', label: text('已收款待发货', 'Paid / ready to ship') },
          { id: 'shipped', label: text('已整单发货', 'Shipped') },
          { id: 'change_requests', label: text('客户变更申请', 'Change requests') },
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
                    <OrderStatusBadge
                      status={order.status}
                      language={language}
                      testId={`sales-order-status-${order.id}`}
                    />
                    {order.change_request && order.change_request.status === 'pending' && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900">
                        {text('待审批', 'Pending review')}:{' '}
                        {order.change_request.request_type === 'cancel_order'
                          ? text('申请取消', 'cancellation')
                          : text('申请改量', 'quantity change')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                    <span>{text('客户', 'Customer')}: <strong className="text-slate-800">{comp?.short_name}</strong> ({comp?.customer_code} / {order.destination_country_alpha3})</span>
                    {comp?.internal_nickname && (
                      <span className="text-indigo-600 font-medium">[{comp.internal_nickname}]</span>
                    )}
                    <span>·</span>
                    <span>{text('下单人', 'Buyer')}: {order.created_by_username}</span>
                    <span>·</span>
                    <span>{text('提交时间', 'Submitted')}: {order.created_at}</span>
                  </div>
                </div>

                <div className="text-left md:text-right">
                  <div className="text-xs text-slate-400">{text('订购总数 / 金额', 'Pieces / amount')}</div>
                  <div className="font-mono font-bold text-sm text-slate-900">
                    {totalPcs} PCS · USD ${order.total_quoted_usd.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Line Items: compact mobile cards, table on larger screens */}
              <div className="sm:hidden space-y-2">
                {order.lines.map((line, index) => {
                  const { totalAvailable } = calculateSKUAvailableStock(line.sku_id, inventory);
                  return (
                    <div key={index} className="rounded-xl border border-slate-200 p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-slate-900">{line.sku_code}</div>
                          <div className="text-slate-600 truncate">{line.product_title}</div>
                          <div className="text-slate-500">{line.color_name}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-bold">{line.quantity} PCS</div>
                          <div className="text-[10px] text-slate-400">{totalAvailable} available</div>
                        </div>
                      </div>
                      <div className="flex justify-between mt-2 text-[11px]">
                        <span className="text-slate-500">${line.quoted_unit_price.toFixed(2)} / PCS</span>
                        <strong className="font-mono">${line.line_subtotal.toFixed(2)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] font-semibold">
                    <tr>
                      <th className="p-2.5 pl-3">{text('SKU 编号', 'SKU')}</th>
                      <th className="p-2.5">{text('商品名称 / 颜色', 'Product / colour')}</th>
                      <th className="p-2.5 text-center">{text('需求数量 (MOQ ≥ 10)', 'Qty (MOQ ≥ 10)')}</th>
                      <th className="p-2.5 text-center">{text('当前可订库存', 'Available')}</th>
                      <th className="p-2.5 text-right">{text('参考单价', 'Unit price')}</th>
                      <th className="p-2.5 pr-3 text-right">{text('小计 (USD)', 'Line total (USD)')}</th>
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
                    <span>
                      {text('收到客户变更申请', 'Customer change request')}:{' '}
                      {order.change_request.request_type === 'cancel_order'
                        ? text('申请取消整单', 'cancel the order')
                        : text('申请修改数量', 'change quantities')}
                    </span>
                    <span className="text-[10px] text-amber-700">{order.change_request.requested_at}</span>
                  </div>
                  <div className="text-amber-800">{text('申请原因', 'Reason')}: {order.change_request.reason}</div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleChangeRequest(order.id, true)}
                      className="px-3 py-1 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"
                    >
                      {text('同意申请 (释放/调整预占)', 'Approve (release / adjust reservation)')}
                    </button>
                    <button
                      onClick={() => handleChangeRequest(order.id, false)}
                      className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                    >
                      {text('驳回申请', 'Reject request')}
                    </button>
                  </div>
                </div>
              )}

              {/* Order Notes & Status Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10px]">
                    {text('运输方式与客户要求', 'Shipping method and customer requirements')}:
                  </span>
                  <div className="text-slate-700">
                    {shippingMethodLabel(order.shipping_method, language)} ·{' '}
                    {text('期望交期', 'Expected ship date')}: {order.expected_ship_date}
                  </div>
                  <div className="text-slate-600 mt-0.5">{order.shipping_requirements}</div>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px]">
                    {text('内部业务备注 (仅业务员与管理员可见)', 'Internal note (sales/admin only)')}:
                  </span>
                  <div className="text-slate-700 font-medium">
                    {order.internal_note || text('暂无内部备注', 'No internal note')}
                  </div>
                </div>
              </div>

              {order.tracking_no && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <span className="text-emerald-700/70 block text-[10px]">{text('承运商', 'Carrier')}</span>
                    <strong>{order.carrier}</strong>
                  </div>
                  <div>
                    <span className="text-emerald-700/70 block text-[10px]">{text('运单号', 'Tracking')}</span>
                    <strong className="font-mono">{order.tracking_no}</strong>
                  </div>
                  <div>
                    <span className="text-emerald-700/70 block text-[10px]">{text('发货 / 预计到达', 'Shipped / ETA')}</span>
                    <strong>{order.actual_ship_date} → {order.estimated_delivery_date}</strong>
                  </div>
                </div>
              )}

              {/* Action Buttons for Sales Rep based on status */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="text-xs text-slate-500">
                  {order.reservation_expires_at && order.status === 'CONFIRMED' && (
                    <span className="text-sky-800 font-medium">
                      {text('预占有效期截止', 'Reservation expires')}: {order.reservation_expires_at.slice(0, 16).replace('T', ' ')} UTC ({text('已延期', 'extended')} {order.reservation_extended_count || 0} {text('次', 'times')})
                    </span>
                  )}
                  {order.payment_recorded_at && (
                    <span className="text-emerald-700 font-medium">
                      {text('实收已入账', 'Payment recorded')}: USD ${order.payment_amount_usd} ({order.payment_reference})
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
                          <span>{text('库存不足，无法完成整单模拟预占（PRD 5.2/T08）', 'Insufficient stock: the whole-order reservation cannot be created (PRD 5.2/T08).')}</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleConfirm(order.id)}
                          data-testid="confirm-order"
                          className="min-h-[44px] px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-sm"
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>{text('确认订单并整单模拟预占 (72h)', 'Confirm order and create 72h demo reservation')}</span>
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
                        title={text('延长 48 小时预占期', 'Extend the reservation by 48 hours')}
                      >
                        {text('延期预占 (+48h)', 'Extend (+48h)')}
                      </button>

                      <button
                        onClick={() => handleRelease(order.id)}
                        className="min-h-[44px] px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold hover:bg-rose-100"
                      >
                        {text('释放预占库存', 'Release reservation')}
                      </button>

                      <button
                        onClick={() => {
                          setPaymentOrder(order);
                          setPaymentAmount(order.total_confirmed_usd ?? order.total_quoted_usd);
                          setPaymentReference(`WIRE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-CITI`);
                        }}
                        className="min-h-[44px] px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm"
                      >
                        <DollarSign className="w-4 h-4" />
                        <span>{text('登记到账入账', 'Record payment')}</span>
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
                      <span>{text('录入整单发货物流', 'Record whole-order shipment')}</span>
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
          <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold">
                  {text('实际付款核对与等级入账登记', 'Payment verification and posting')}
                </h3>
              </div>
              <button onClick={() => setPaymentOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleRecordPaymentSubmit} className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                <div>{text('订单号', 'Order')}: <strong className="font-mono">{paymentOrder.order_no}</strong></div>
                <div>{text('确认应收总额', 'Confirmed amount due')}: <strong className="font-mono text-slate-900">USD ${(paymentOrder.total_confirmed_usd ?? paymentOrder.total_quoted_usd).toFixed(2)}</strong></div>
                <div className="text-amber-700">
                  {text('本 Demo 只接受整单全额付款，不支持部分付款。', 'This demo accepts full payment only; partial payment is not supported.')}
                </div>
                <div>{text('结算方式', 'Settlement')}: {text('线下电汇', 'offline T/T bank wire')}</div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {text('实际核验到账金额 (USD)', 'Verified amount received (USD)')}
                </label>
                <SelectAllOnFocusInput
                  type="number"
                  step="0.01"
                  min="1"
                  value={paymentAmount}
                  data-testid="payment-amount"
                  onChange={e => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {text('银行汇款水单编号 / 索引凭据', 'Bank wire reference')}
                </label>
                <SelectAllOnFocusInput
                  type="text"
                  value={paymentReference}
                  data-testid="payment-reference"
                  onChange={e => setPaymentReference(e.target.value)}
                  placeholder={text('例如：WIRE-20261101-CITI8819', 'e.g. WIRE-20261101-CITI8819')}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl text-[11px] text-emerald-900 leading-relaxed">
                {text('PRD 7.1 入账联动逻辑: ', 'PRD 7.1 posting rule: ')}
                {text(
                  '登记付款后，订单将锁定为【已付款】不可取消状态；该笔金额将实时计入客户公司的历史累计有效采购额，并立即重置未采购计时，恢复或提升客户采购等级！',
                  'Recording payment locks the order as paid and non-cancellable, adds the amount to the customer company effective spend, resets the inactivity clock and may restore or raise the customer tier.'
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentOrder(null)}
                  className="flex-1 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  {text('取消', 'Cancel')}
                </button>
                <button
                  type="submit"
                  data-testid="submit-payment"
                  className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  {text('确认到账并入账', 'Confirm and post payment')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Shipment Modal (PRD 6.3, D11, T15, T16) */}
      {shipmentOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold">
                  {text('整单发货录入', 'Record whole-order shipment')}
                </h3>
              </div>
              <button onClick={() => setShipmentOrder(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleShipmentSubmit} className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                <div>{text('订单号', 'Order')}: <strong className="font-mono">{shipmentOrder.order_no}</strong></div>
                <div>
                  {text('目的国家', 'Destination')}: <strong>{shipmentOrder.destination_country_alpha3}</strong> ·{' '}
                  {text('发货原则: 严格整单发货，不支持部分发货 (PRD D11)', 'Whole-order shipment only; partial shipment is not supported (PRD D11).')}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{text('承运商', 'Carrier')}</label>
                  <SelectAllOnFocusInput
                    type="text"
                    value={carrier}
                    data-testid="shipment-carrier"
                    onChange={e => setCarrier(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{text('国际运单号', 'Tracking number')}</label>
                  <SelectAllOnFocusInput
                    type="text"
                    value={trackingNo}
                    data-testid="shipment-tracking"
                    onChange={e => setTrackingNo(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{text('实际发货日期', 'Actual ship date')}</label>
                  <input
                    type="date"
                    value={actualShipDate}
                    data-testid="shipment-date"
                    onChange={e => setActualShipDate(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{text('预计到达日期', 'Estimated delivery date')}</label>
                  <input
                    type="date"
                    value={estimatedDelivery}
                    data-testid="shipment-eta"
                    onChange={e => setEstimatedDelivery(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {text('客户可见备注说明', 'Customer-visible note')}
                </label>
                <SelectAllOnFocusInput
                  type="text"
                  value={customerVisibleNote}
                  onChange={e => setCustomerVisibleNote(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {text('内部业务备注 (绝对隔离不向客户展示)', 'Internal note (never shown to the customer)')}
                </label>
                <SelectAllOnFocusInput
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
                  {text('取消', 'Cancel')}
                </button>
                <button
                  type="submit"
                  data-testid="submit-shipment"
                  className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  {text('确认出库发货', 'Confirm shipment')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
