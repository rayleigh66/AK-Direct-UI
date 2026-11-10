import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, RefreshCw, ShieldAlert } from 'lucide-react';
import { AuthApiError } from '../../auth/api';
import {
  cancelCustomerOrder,
  getAdminCompany,
  getAdminOrder,
  getCustomerOrder,
  getSalesOrder,
  listAdminOrders,
  listCustomerOrders,
  listSalesOrders,
  listSalesUsers,
  modifyOrderLines,
} from '../api';
import { usdFromCents } from '../cart';
import type {
  AdminCustomerCompanyDto,
  AdminSalesUserDto,
  CustomerOrderDto,
  InternalOrderDto,
} from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';
import { OrderStatusBadge } from '../../components/ui/OrderStatusBadge';
import type { OrderStatus } from '../../types';
import { shippingMethodLabel } from '../../utils/orderStatus';
import { QuantityField } from '../../components/ui/QuantityField';
import { SideDrawer } from '../../components/ui/SideDrawer';
import { HelpTooltip } from '../../components/ui/HelpTooltip';
import { formatEnglishDate } from '../../utils/dateDisplay';
import { useInternalLanguage } from '../internalLanguage';

type OrderView = CustomerOrderDto | InternalOrderDto;

function isInternal(order: OrderView): order is InternalOrderDto {
  return 'company' in order;
}

function pieces(order: OrderView): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
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
  const [adminDrawerOpen, setAdminDrawerOpen] = useState(false);
  const [adminDrawerKind, setAdminDrawerKind] = useState<'order' | 'customer'>('order');
  const [customerOrder, setCustomerOrder] = useState<InternalOrderDto | null>(null);
  const [customerCompany, setCustomerCompany] = useState<AdminCustomerCompanyDto | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const [salesUsers, setSalesUsers] = useState<AdminSalesUserDto[]>([]);
  const detailRequest = useRef(0);
  const customerRequest = useRef(0);
  const { language } = useInternalLanguage();
  const text = (en: string, zh: string) => (scope === 'customer' ? en : language === 'zh' ? zh : en);
  const localizedError = (value: string) =>
    scope === 'customer' || language === 'en' || /[\u3400-\u9fff]/.test(value)
      ? value
      : '操作失败，请重试或联系管理员。';

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

  useEffect(() => {
    if (scope !== 'admin') return;
    listSalesUsers()
      .then(setSalesUsers)
      .catch(() => setSalesUsers([]));
  }, [scope]);

  const loadDetail = async (id: string): Promise<void> => {
    const token = ++detailRequest.current;
    if (scope !== 'customer') {
      // Internal order details open in the shared right-side drawer for both
      // administrators and salespeople. Customer orders keep the inline detail.
      setAdminDrawerKind('order');
      setAdminDrawerOpen(true);
      setCustomerError('');
    }
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
      if (token !== detailRequest.current) return;
      setDetail(item);
      setLineDrafts(
        Object.fromEntries(item.lines.map(line => [line.skuId, String(line.quantity)]))
      );
    } catch (err) {
      if (token !== detailRequest.current) return;
      setActionError(err instanceof Error ? err.message : 'The order could not be loaded.');
      setDetail(null);
    } finally {
      if (token === detailRequest.current) setDetailLoading(false);
    }
  };

  const openOrder = (order: OrderView) => {
    void loadDetail(order.id);
  };

  const openCustomer = (order: InternalOrderDto) => {
    const token = ++customerRequest.current;
    setCustomerOrder(order);
    setCustomerCompany(null);
    setCustomerError('');
    setCustomerLoading(true);
    setAdminDrawerKind('customer');
    setAdminDrawerOpen(true);
    getAdminCompany(order.company.id)
      .then(company => {
        if (token === customerRequest.current) setCustomerCompany(company);
      })
      .catch(err => {
        if (token === customerRequest.current) {
          setCustomerError(
            err instanceof Error ? err.message : 'The customer details could not be loaded.'
          );
        }
      })
      .finally(() => {
        if (token === customerRequest.current) setCustomerLoading(false);
      });
  };

  const closeAdminDrawer = () => setAdminDrawerOpen(false);

  const clearAdminDrawer = () => {
    setAdminDrawerOpen(false);
    setSelectedId(null);
    setDetail(null);
    setCustomerOrder(null);
    setCustomerCompany(null);
    setCustomerError('');
  };

  const closeInlineDetail = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const salesperson = (id?: string | null) => {
    if (!id) return text('Unassigned', '未分配');
    const user = salesUsers.find(item => item.id === id);
    return user ? `${user.name} · ${user.email}` : id;
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
        setActionError(text('Change at least one quantity first.', '请先修改至少一个数量。'));
        return;
      }
      const updated = await modifyOrderLines(detail.id, detail.revision, changed);
      setDetail(updated);
      setLineDrafts(
        Object.fromEntries(updated.lines.map(line => [line.skuId, String(line.quantity)]))
      );
      setNotice(
        text(
          'Order quantities updated. Reference total recalculated.',
          '订单数量已更新，参考总额已重新计算。'
        )
      );
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
      setNotice(text('Order cancelled.', '订单已取消。'));
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

  if (loading) {
    return (
      <LoadingBlock
        label={scope === 'customer' ? 'Loading orders…' : text('Loading orders…', '正在加载订单…')}
      />
    );
  }
  if (error) return <ErrorBlock message={localizedError(error)} onRetry={load} />;

  const renderCustomerDetail = () => {
    const order = customerOrder;
    if (!order) return null;
    const company = customerCompany;
    const assignedSalesUserId = company?.assignedSalesUserId ?? order.currentAssignedSalesUserId;
    return (
      <div data-testid="customer-detail" className="space-y-4">
        {customerLoading ? (
          <LoadingBlock label={text('Loading customer details…', '正在加载客户资料…')} />
        ) : (
          <>
            {customerError && (
              <ErrorBlock
                message={localizedError(customerError)}
                onRetry={() => openCustomer(order)}
              />
            )}
            <div className="grid gap-2 text-xs sm:grid-cols-2" data-testid="customer-detail-company">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-slate-400">{text('Customer code', '客户编码')}</div>
                <div className="font-mono font-semibold">
                  {company?.customerCode ?? order.company.customerCode}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-slate-400">{text('Customer name', '客户简称')}</div>
                <div className="font-semibold">
                  {company?.shortName ?? order.company.shortName}
                </div>
              </div>
              {company && (
                <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-400">{text('Country', '国家')}</div>
                    <div className="font-semibold">{company.countryAlpha3}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-400">{text('Status', '状态')}</div>
                    <div className="font-semibold">
                      {company.status === 'active'
                        ? text('Active', '启用')
                        : text('Suspended', '已停用')}
                    </div>
                  </div>
                  {company.internalNickname && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-slate-400">
                        {text('Internal nickname', '内部简称')}
                      </div>
                      <div className="font-semibold">{company.internalNickname}</div>
                    </div>
                  )}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-400">{text('Created', '创建时间')}</div>
                    <div className="font-semibold">{formatEnglishDate(company.createdAt)}</div>
                  </div>
                </>
              )}
            </div>
            <div
              className="rounded-xl border border-slate-200 p-3 text-xs"
              data-testid="customer-detail-order"
            >
              <div className="text-slate-400">{text('Related order', '关联订单')}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{order.orderNo}</span>
                <OrderStatusBadge status={order.status as OrderStatus} language={language} />
                <span className="ml-auto text-slate-500">
                  {formatEnglishDate(order.submittedAt)}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-slate-600">
                <div>
                  {text('Submitted by', '下单账号')}{' '}
                  <span className="font-mono">{order.submittedByUsername}</span>
                </div>
                <div>
                  {text('Reference total', '参考总额')}{' '}
                  {usdFromCents(order.referenceTotalCents)}
                </div>
                <div>
                  {text('Expected ship', '预计发货')}{' '}
                  {formatEnglishDate(order.expectedShipDate)}
                </div>
              </div>
            </div>
            <div
              className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
              data-testid="customer-detail-salesperson"
            >
              <div className="text-slate-400">{text('Assigned salesperson', '负责业务员')}</div>
              <div className="font-semibold">{salesperson(assignedSalesUserId)}</div>
            </div>
            <button
              type="button"
              onClick={() => void loadDetail(order.id)}
              data-testid="customer-detail-back"
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> {text('Back to order', '返回订单')}
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList className="w-5 h-5 text-[#ff681e]" />
          <h2 className="text-base font-extrabold">
            {scope === 'customer'
              ? 'My company orders'
              : scope === 'sales'
                ? text('Pending orders', '待确认订单')
                : text('Order supervision', '订单监督')}
          </h2>
          <span className="text-[11px] text-slate-500">
            {scope === 'customer'
              ? 'All accounts of your company can see these orders.'
              : scope === 'sales'
                ? text('Only customers assigned to you.', '仅显示分配给你的客户订单。')
                : text(
                    'Read-only supervision of all customer orders.',
                    '只读监管全部客户订单。'
                  )}
          </span>
          <button
            type="button"
            onClick={() => void refreshAll(selectedId ?? undefined)}
            className="ml-auto min-h-[38px] px-3 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> {text('Refresh', '刷新')}
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
          {localizedError(actionError)}
        </div>
      )}

      {!orders.length ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
          {text('No orders yet.', '暂无订单。')}
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(order => (
            <div
              key={order.id}
              role="button"
              tabIndex={0}
              onClick={event => {
                event.currentTarget.focus({ preventScroll: true });
                openOrder(order);
              }}
              onKeyDown={event => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openOrder(order);
                }
              }}
              data-testid={scope === 'customer' ? 'customer-order-card' : 'internal-order-card'}
              data-order-no={order.orderNo}
              className={`w-full cursor-pointer text-left bg-white border rounded-2xl p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff681e] ${
                selectedId === order.id
                  ? 'border-[#ff681e]'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold">{order.orderNo}</span>
                <OrderStatusBadge
                  status={order.status as OrderStatus}
                  language={scope === 'customer' ? 'en' : language}
                  testId={`internal-order-status-${order.id}`}
                />
                {isInternal(order) &&
                  (scope === 'admin' ? (
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        openCustomer(order);
                      }}
                      onKeyDown={event => event.stopPropagation()}
                      data-testid="admin-order-customer-link"
                      data-company-code={order.company.customerCode}
                      aria-label={`Open customer details for ${order.company.customerCode} ${order.company.shortName}`}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 underline-offset-2 hover:bg-slate-200 hover:underline"
                    >
                      {order.company.customerCode} · {order.company.shortName}
                    </button>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                      {order.company.customerCode} · {order.company.shortName}
                    </span>
                  ))}
                <span className="ml-auto text-slate-500">{formatEnglishDate(order.submittedAt)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span>
                  {order.lines.length} {text('lines', '行')} · {pieces(order)} PCS
                </span>
                <span>
                  {text('Reference', '参考')} {usdFromCents(order.referenceTotalCents)}
                </span>
                <span>
                  {order.shippingMethod} · {order.destinationCountryAlpha3} ·{' '}
                  {formatEnglishDate(order.expectedShipDate)}
                </span>
                {isInternal(order) && (
                  <span>{text('Buyer', '下单人')} {order.submittedByUsername}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(() => {
        const orderContent = detail ? (
          <div data-testid="order-detail" className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {text('Order', '订单')}
                  </div>
                  <div className="text-lg font-extrabold font-mono">{detail.orderNo}</div>
                </div>
                <OrderStatusBadge
                  status={detail.status as OrderStatus}
                  language={scope === 'customer' ? 'en' : language}
                />
                <span className="text-[11px] text-slate-500">
                  {text('Revision', '版本')} {detail.revision} ·{' '}
                  {text('updated', '更新于')} {formatEnglishDate(detail.updatedAt)}
                </span>
                {scope === 'customer' && (
                  <button
                    type="button"
                    onClick={closeInlineDetail}
                    className="ml-auto min-h-[36px] px-3 rounded-xl border border-slate-300 text-xs font-semibold"
                  >
                    {text('Close', '关闭')}
                  </button>
                )}
              </div>

              {isInternal(detail) && (
                <div className="grid sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-slate-400">{text('Customer company', '客户公司')}</div>
                    {scope === 'admin' ? (
                      <button
                        type="button"
                        onClick={() => openCustomer(detail)}
                        data-testid="admin-order-customer-detail"
                        className="font-semibold text-left underline decoration-dotted underline-offset-2 hover:decoration-[#ff681e]"
                      >
                        {detail.company.customerCode} · {detail.company.shortName}
                      </button>
                    ) : (
                      <div className="font-semibold">
                        {detail.company.customerCode} · {detail.company.shortName}
                      </div>
                    )}
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-slate-400">{text('Submitted by', '提交人')}</div>
                    <div className="font-mono font-semibold">{detail.submittedByUsername}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-slate-400">{text('Current salesperson (access scope)', '当前销售负责人（访问范围）')}</div>
                    <div className="text-[11px] font-semibold break-all">
                      {scope === 'admin'
                        ? salesperson(detail.currentAssignedSalesUserId)
                        : detail.currentAssignedSalesUserId ?? text('Unassigned', '未分配')}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {text('Submitted under', '提交时归属')}{' '}
                      {scope === 'admin'
                        ? salesperson(detail.assignedSalesUserId)
                        : detail.assignedSalesUserId ?? text('no salesperson', '无销售')}{' '}
                      ({text('audit snapshot', '审计快照')})
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
                        {text('Qty', '数量')}
                        <QuantityField
                          min={10}
                          value={lineDrafts[line.skuId] ?? ''}
                          onValueChange={value =>
                            setLineDrafts(prev => ({ ...prev, [line.skuId]: value }))
                          }
                          className="ml-1 w-20 h-9 px-2 rounded-lg border border-slate-300 text-center"
                          testId="order-line-qty"
                          ariaLabel={text(`Quantity for ${line.skuCode}`, `${line.skuCode} 的数量`)}
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
                  <span className="text-slate-500">{text('Reference total', '参考总额')}</span>
                  <span className="text-base font-extrabold text-[#ff681e]">
                    {usdFromCents(detail.referenceTotalCents)}
                  </span>
                </div>
                <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                  <span>{text('Reference prices only.', '仅为参考报价。')}</span>
                  <HelpTooltip label={text('Reference pricing details', '参考价格说明')} align="right">
                    {detail.priceNote}
                  </HelpTooltip>
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-400">{text('Delivery', '交付')}</div>
                  <div className="font-semibold">
                    {scope === 'customer'
                      ? detail.shippingMethod
                      : shippingMethodLabel(detail.shippingMethod, language)}{' '}
                    · {detail.destinationCountryAlpha3} ·{' '}
                    {text('expected ship', '预计发货')} {formatEnglishDate(detail.expectedShipDate)}
                  </div>
                  {detail.shippingRequirements && (
                    <div className="text-slate-600 mt-1">{detail.shippingRequirements}</div>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-400">{text('Status note', '状态说明')}</div>
                  <div className="text-slate-600">{detail.customerVisibleNote}</div>
                  {detail.cancelReason && (
                    <div className="text-rose-700 mt-1">
                      {text('Cancellation', '取消原因')}: {detail.cancelReason}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">{text('History', '历史')}</div>
                <div className="space-y-1">
                  {detail.history.map((event, index) => (
                    <div
                      key={`${event.eventType}-${index}`}
                      className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex flex-wrap gap-2"
                    >
                      <span className="font-semibold">
                        {scope === 'customer'
                          ? event.eventType
                          : event.eventType === 'SUBMITTED'
                            ? text('Submitted', '已提交')
                            : event.eventType === 'LINES_MODIFIED'
                              ? text('Quantities modified', '数量已修改')
                              : event.eventType === 'CANCELLED'
                                ? text('Cancelled', '已取消')
                                : event.eventType === 'ADMIN_CANCELLED'
                                  ? text('Cancelled by administrator', '管理员取消')
                                  : event.eventType}
                      </span>
                      <span>{event.reason}</span>
                      {'actorLabel' in event && (
                        <span className="text-slate-400">{text('by', '由')} {event.actorLabel}</span>
                      )}
                      <span className="ml-auto text-slate-400">{formatEnglishDate(event.createdAt)}</span>
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
                    {text('Save quantity changes', '保存数量变更')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    className="min-h-[42px] px-4 rounded-xl border border-rose-300 text-rose-700 text-xs font-bold"
                    data-testid="order-cancel-open"
                  >
                    {text('Cancel order', '取消订单')}
                  </button>
                  <span className="text-[10px] text-slate-500 self-center">
                    {text('Only pending-confirmation orders can be changed or cancelled.', '只有待确认订单可以修改或取消。')}
                  </span>
                </div>
              )}

              {scope === 'customer' && cancelOpen && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
                  <div className="text-xs font-semibold text-rose-800">
                    {text('Cancel this pending order? This cannot be undone.', '取消该待确认订单？此操作不可撤销。')}
                  </div>
                  <input
                    value={cancelReason}
                    onChange={event => setCancelReason(event.target.value)}
                    maxLength={500}
                    placeholder={text('Reason (optional, max 500 characters)', '原因（选填，最多 500 字符）')}
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
                      {text('Confirm cancellation', '确认取消')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelOpen(false)}
                      className="min-h-[40px] px-4 rounded-xl border border-rose-300 text-xs font-semibold"
                    >
                      {text('Keep order', '保留订单')}
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
                    {text('Confirm order — available in Phase 4B-05', '确认订单 —— Phase 4B-05 开放')}
                  </button>
                  <span className="text-[10px] text-slate-500">
                    {text('Confirmation, final pricing and stock reservation are not implemented in this phase.', '本阶段尚未实现确认、最终定价与库存预占。')}
                  </span>
                </div>
              )}

              {scope === 'admin' && (
                <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  {text(
                    'Administrator supervision is read-only. Sales confirmation requires the sales write workflow in Phase 4B-05.',
                    '管理员监督为只读。销售确认需要 Phase 4B-05 的销售写流程。'
                  )}
                </div>
              )}
          </div>
        ) : null;

        if (scope !== 'customer') {
          return (
            <SideDrawer
              open={adminDrawerOpen}
              onClose={closeAdminDrawer}
              onClosed={clearAdminDrawer}
              title={
                adminDrawerKind === 'customer'
                  ? text('Customer details', '客户资料')
                  : text('Order details', '订单详情')
              }
              subtitle={
                adminDrawerKind === 'customer'
                  ? customerOrder
                    ? `${customerOrder.company.customerCode} · ${customerOrder.company.shortName}`
                    : undefined
                  : detail?.orderNo
              }
              testId={
                adminDrawerKind === 'customer' ? 'customer-detail-drawer' : 'order-detail-drawer'
              }
              closeTestId={`${adminDrawerKind}-drawer-close`}
              closeLabel={text('Close', '关闭')}
            >
              {adminDrawerKind === 'order' ? (
                detailLoading ? (
                  <LoadingBlock label={text('Loading order detail…', '正在加载订单详情…')} />
                ) : orderContent ? (
                  orderContent
                ) : (
                  <ErrorBlock
                    message={localizedError(
                      actionError || text('The order could not be loaded.', '订单加载失败。')
                    )}
                    onRetry={() => selectedId && void loadDetail(selectedId)}
                  />
                )
              ) : (
                renderCustomerDetail()
              )}
            </SideDrawer>
          );
        }

        if (!detail && !detailLoading) return null;
        return (
          <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
            {detailLoading || !orderContent ? (
              <LoadingBlock label={text('Loading order detail…', '正在加载订单详情…')} />
            ) : (
              orderContent
            )}
          </section>
        );
      })()}
    </div>
  );
};
