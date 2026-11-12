import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, RefreshCw, ShieldAlert } from 'lucide-react';
import { AuthApiError } from '../../auth/api';
import {
  cancelCustomerOrder,
  confirmSalesOrder,
  decidePlanAcceptance,
  getAdminCompany,
  getAdminOrder,
  getCustomerOrder,
  getSalesOrder,
  listAdminOrders,
  listCustomerOrders,
  listSalesOrders,
  listSalesUsers,
  listSalesWarehouses,
  modifyOrderLines,
  requestOrderExtension,
  requestOrderRelease,
  saveSalesPlan,
} from '../api';
import { usdFromCents } from '../cart';
import type {
  AdminCustomerCompanyDto,
  AdminSalesUserDto,
  CustomerOrderDto,
  InternalOrderDto,
  InternalPlanDto,
  WarehouseDto,
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
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [planDrafts, setPlanDrafts] = useState<
    Record<string, { quantity: string; unitPrice: string }>
  >({});
  const [allocations, setAllocations] = useState<
    Record<string, Array<{ warehouseId: string; quantity: string }>>
  >({});
  const [rejectReason, setRejectReason] = useState('');
  const [extensionHours, setExtensionHours] = useState('24');
  const [extensionReason, setExtensionReason] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [verificationNote, setVerificationNote] = useState('');
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

  useEffect(() => {
    if (scope !== 'sales') return;
    listSalesWarehouses()
      .then(setWarehouses)
      .catch(() => setWarehouses([]));
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
    setNotice('');
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
      const planLines = item.currentPlan?.lines;
      const draftLines = planLines?.length ? planLines : item.lines;
      setPlanDrafts(
        Object.fromEntries(
          draftLines.map(line => {
            const unitPriceCents =
              'unitPriceCents' in line ? line.unitPriceCents : line.referenceUnitPriceCents;
            return [
              line.skuId,
              {
                quantity: String(line.quantity),
                unitPrice: (unitPriceCents / 100).toFixed(2),
              },
            ];
          })
        )
      );
      const firstWarehouse = warehouses[0]?.id ?? '';
      setAllocations(
        Object.fromEntries(
          draftLines.map(line => [
            line.skuId,
            [{ warehouseId: firstWarehouse, quantity: String(line.quantity) }],
          ])
        )
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

  const idempotencyKey = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const savePlan = async () => {
    if (!detail || busy || !isInternal(detail)) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const lines = detail.lines.map(line => {
        const draft = planDrafts[line.skuId];
        return {
          skuId: line.skuId,
          quantity: Number(draft?.quantity ?? line.quantity),
          unitPriceCents: Math.round(Number(draft?.unitPrice ?? '0') * 100),
        };
      });
      const result = await saveSalesPlan(detail.id, {
        expectedRevision: detail.revision,
        expectedPlanVersion: detail.currentPlan?.version ?? 0,
        lines,
        idempotencyKey: idempotencyKey(),
      });
      setDetail(result.order);
      setNotice(
        text(
          `Plan v${result.plan.version} saved. ${
            result.plan.priceApprovalStatus === 'PENDING'
              ? 'A business administrator must approve the price change.'
              : result.plan.priceApprovalStatus === 'REJECTED'
                ? 'The current price state is still declined; change the price to request a new approval.'
                : 'The plan is ready for the buyer confirmer.'
          }`,
          `方案 v${result.plan.version} 已保存。`
        )
      );
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Plan save failed.');
      await refreshAll(detail.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const decidePlan = async (outcome: 'ACCEPTED' | 'REJECTED') => {
    if (!detail || busy || !detail.currentPlan) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const updated = await decidePlanAcceptance(detail.id, {
        expectedRevision: detail.revision,
        expectedPlanVersion: detail.currentPlan.version,
        planDigest: detail.currentPlan.planDigest,
        outcome,
        reason: outcome === 'REJECTED' ? rejectReason.trim() : undefined,
        idempotencyKey: idempotencyKey(),
      });
      setDetail(updated);
      setRejectReason('');
      setNotice(
        outcome === 'ACCEPTED'
          ? text('Plan accepted. Sales can now confirm the order.', '方案已认可，业务员现在可以确认订单。')
          : text('Plan returned to sales.', '方案已退回业务员。')
      );
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Plan decision failed.');
      await refreshAll(detail.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const confirmWithAllocations = async () => {
    if (!detail || busy || !detail.currentPlan || !detail.acceptance) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const payload = detail.currentPlan.lines.flatMap(line =>
        (allocations[line.skuId] ?? [])
          .filter(row => row.warehouseId && Number(row.quantity) > 0)
          .map(row => ({
            skuId: line.skuId,
            warehouseId: row.warehouseId,
            quantity: Number(row.quantity),
          }))
      );
      const updated = await confirmSalesOrder(detail.id, {
        expectedRevision: detail.revision,
        expectedPlanVersion: detail.currentPlan.version,
        planDigest: detail.currentPlan.planDigest,
        acceptanceId: detail.acceptance.id,
        allocations: payload,
        idempotencyKey: idempotencyKey(),
      });
      setDetail(updated);
      setNotice(text('Order confirmed and stock reserved.', '订单已确认并预占库存。'));
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Confirmation failed.');
      await refreshAll(detail.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const submitExtension = async () => {
    if (!detail || busy || !detail.confirmation?.reservation) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const result = await requestOrderExtension(detail.id, {
        expectedRevision: detail.revision,
        expectedReservationVersion: detail.confirmation.reservation.version,
        additionalHours: Number(extensionHours),
        reason: extensionReason.trim(),
        idempotencyKey: idempotencyKey(),
      });
      setDetail(result.order);
      setExtensionReason('');
      setNotice(text('Extension request submitted for approval.', '延期申请已提交审批。'));
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Extension request failed.');
      await refreshAll(detail.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const submitRelease = async () => {
    if (!detail || busy || !detail.confirmation?.reservation) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const result = await requestOrderRelease(detail.id, {
        expectedRevision: detail.revision,
        expectedReservationVersion: detail.confirmation.reservation.version,
        reason: releaseReason.trim(),
        paymentVerification: 'unpaid',
        shipmentVerification: 'not_shipped',
        verificationNote: verificationNote.trim(),
        idempotencyKey: idempotencyKey(),
      });
      setDetail(result.order);
      setReleaseReason('');
      setVerificationNote('');
      setNotice(text('Release request submitted for approval.', '释放申请已提交审批。'));
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Release request failed.');
      await refreshAll(detail.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const updateAllocation = (
    skuId: string,
    index: number,
    patch: { warehouseId?: string; quantity?: string }
  ) => {
    setAllocations(prev => ({
      ...prev,
      [skuId]: (prev[skuId] ?? []).map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    }));
  };

  const addAllocationRow = (skuId: string, quantity: number) => {
    setAllocations(prev => ({
      ...prev,
      [skuId]: [
        ...(prev[skuId] ?? []),
        { warehouseId: warehouses[0]?.id ?? '', quantity: String(quantity) },
      ],
    }));
  };

  const removeAllocationRow = (skuId: string, index: number) => {
    setAllocations(prev => ({
      ...prev,
      [skuId]: (prev[skuId] ?? []).filter((_row, rowIndex) => rowIndex !== index),
    }));
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
                    {scope === 'customer' &&
                    detail.status === 'PENDING_CONFIRMATION' &&
                    !detail.currentPlan ? (
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

              {detail.currentPlan && (
                <div
                  data-testid="order-plan"
                  className="rounded-xl border border-slate-200 p-3 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">
                      {text('Sales plan', '销售方案')} v{detail.currentPlan.version}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">
                      {detail.currentPlan.status}
                    </span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      {text('Price approval', '价格审批')}: {detail.currentPlan.priceApprovalStatus}
                    </span>
                    <span className="ml-auto font-extrabold text-[#ff681e]">
                      {usdFromCents(detail.currentPlan.totalCents)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {detail.currentPlan.lines.map(line => (
                      <div
                        key={`plan-${line.skuId}`}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-2"
                      >
                        <span className="font-mono text-[10px] text-slate-400">
                          {line.productCode} · {line.skuCode}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {line.productTitleEn}
                        </span>
                        <span>{line.quantity} PCS</span>
                        <span className="w-20 text-right">
                          {usdFromCents(line.unitPriceCents)} / pc
                        </span>
                        <span className="w-24 text-right font-bold">
                          {usdFromCents(line.lineTotalCents)}
                        </span>
                        {line.priceChanged && (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                            {text('price changed', '已改价')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {detail.currentPlan.priceApprovalStatus === 'PENDING' && (
                    <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
                      {text(
                        'A business administrator must approve this price change before the buyer can accept.',
                        '业务管理员必须先批准本次改价，采购账号才能认可。'
                      )}
                    </div>
                  )}
                  {detail.currentPlan.priceApprovalStatus === 'REJECTED' && (
                    <div className="rounded-lg bg-rose-50 p-2 text-rose-800">
                      {text(
                        'The price change was declined. Sales must submit a new price state.',
                        '改价已被驳回，业务员必须提交新的价格状态。'
                      )}
                    </div>
                  )}
                  {detail.acceptance && (
                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
                      {text('Buyer acceptance', '采购认可')}: {detail.acceptance.outcome} ·{' '}
                      {formatEnglishDate(detail.acceptance.decidedAt)}
                    </div>
                  )}
                  {detail.currentPlan.status === 'REJECTED' &&
                    detail.currentPlan.priceApprovalStatus !== 'REJECTED' && (
                      <div className="rounded-lg bg-rose-50 p-2 text-rose-800">
                        {text(
                          'The buyer returned this plan to sales.',
                          '采购账号已将方案退回业务员。'
                        )}
                      </div>
                    )}
                  {scope === 'customer' &&
                    detail.status === 'PENDING_CONFIRMATION' &&
                    detail.canAcceptPlan && (
                      <div className="space-y-2 border-t border-slate-100 pt-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decidePlan('ACCEPTED')}
                            data-testid="order-plan-accept"
                            className="min-h-[40px] rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {text('Accept this plan', '认可该方案')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decidePlan('REJECTED')}
                            data-testid="order-plan-reject"
                            className="min-h-[40px] rounded-xl border border-rose-300 px-4 text-xs font-bold text-rose-700 disabled:opacity-50"
                          >
                            {text('Reject and return to sales', '拒绝并退回业务员')}
                          </button>
                        </div>
                        <input
                          value={rejectReason}
                          onChange={event => setRejectReason(event.target.value)}
                          maxLength={1000}
                          placeholder={text('Rejection reason (optional)', '拒绝原因（选填）')}
                          className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs"
                          data-testid="order-plan-reject-reason"
                        />
                      </div>
                    )}
                </div>
              )}

              {detail.confirmation && (
                <div
                  data-testid="order-confirmation"
                  className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{text('Confirmed order', '已确认订单')}</span>
                    <span className="ml-auto text-base font-extrabold">
                      {usdFromCents(detail.confirmation.finalTotalCents)}
                    </span>
                  </div>
                  {detail.confirmation.reservation && (
                    <div className="grid gap-1 sm:grid-cols-2">
                      <div>
                        {text('Reservation', '预占')}:{' '}
                        <span
                          data-testid="reservation-status"
                          className={
                            detail.confirmation.reservation.effectiveStatus === 'EXPIRED'
                              ? 'font-bold text-rose-700'
                              : 'font-bold'
                          }
                        >
                          {detail.confirmation.reservation.effectiveStatus}
                        </span>
                      </div>
                      <div>
                        {text('Expires', '到期')}:{' '}
                        {formatEnglishDate(detail.confirmation.reservation.expiresAt)}
                      </div>
                      <div>
                        {text('Hard deadline', '最迟期限')}:{' '}
                        {formatEnglishDate(detail.confirmation.reservation.hardDeadlineAt)}
                      </div>
                      <div>
                        {text('Approved extension', '已批延期')}:{' '}
                        {detail.confirmation.reservation.totalExtensionHours}h
                      </div>
                      {detail.confirmation.reservation.overdue && (
                        <div className="font-bold text-rose-700 sm:col-span-2">
                          {text(
                            'This reservation is overdue. Stock is still held and requires an approved extension or release.',
                            '预占已逾期。库存仍被占用，需要审批延期或释放。'
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {scope === 'sales' &&
                isInternal(detail) &&
                detail.status === 'PENDING_CONFIRMATION' && (
                  <div
                    data-testid="sales-plan-editor"
                    className="rounded-xl border border-slate-200 p-3 space-y-2 text-xs"
                  >
                    <div className="font-bold">
                      {text('Build the complete plan', '拟定完整方案')}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {text(
                        'Every line is required. Any manual unit-price change, in either direction, creates a new price approval.',
                        '必须包含全部订单行。任何人工单价改动（升降皆然）都会生成新的价格审批。'
                      )}
                    </div>
                    {detail.lines.map(line => (
                      <div
                        key={`plan-edit-${line.skuId}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                          {line.skuCode}
                        </span>
                        <label className="text-[10px] text-slate-500">
                          {text('Qty', '数量')}
                          <input
                            type="number"
                            min={10}
                            value={planDrafts[line.skuId]?.quantity ?? ''}
                            onChange={event =>
                              setPlanDrafts(prev => ({
                                ...prev,
                                [line.skuId]: {
                                  ...(prev[line.skuId] ?? { unitPrice: '' }),
                                  quantity: event.target.value,
                                },
                              }))
                            }
                            data-testid={`plan-qty-${line.skuCode}`}
                            className="ml-1 h-9 w-20 rounded-lg border border-slate-300 px-2 text-center"
                          />
                        </label>
                        <label className="text-[10px] text-slate-500">
                          {text('USD / pc', '美元单价')}
                          <input
                            type="number"
                            min={0.01}
                            step="0.01"
                            value={planDrafts[line.skuId]?.unitPrice ?? ''}
                            onChange={event =>
                              setPlanDrafts(prev => ({
                                ...prev,
                                [line.skuId]: {
                                  ...(prev[line.skuId] ?? { quantity: '' }),
                                  unitPrice: event.target.value,
                                },
                              }))
                            }
                            data-testid={`plan-price-${line.skuCode}`}
                            className="ml-1 h-9 w-24 rounded-lg border border-slate-300 px-2 text-right"
                          />
                        </label>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void savePlan()}
                      data-testid="sales-plan-save"
                      className="min-h-[40px] rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {text(
                        `Save plan v${(detail.currentPlan?.version ?? 0) + 1}`,
                        `保存方案 v${(detail.currentPlan?.version ?? 0) + 1}`
                      )}
                    </button>
                  </div>
                )}

              {scope === 'sales' &&
                isInternal(detail) &&
                detail.status === 'PENDING_CONFIRMATION' &&
                detail.currentPlan?.status === 'ACCEPTED' &&
                detail.acceptance && (
                  <div
                    data-testid="sales-confirm"
                    className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2 text-xs"
                  >
                    <div className="font-bold">
                      {text('Confirm with warehouse allocation', '按仓库分配并正式确认')}
                    </div>
                    <div className="text-[10px] text-emerald-900">
                      {text(
                        'Each line allocation must add up to the accepted quantity. A shortage in any warehouse fails the whole order.',
                        '每行分仓数量合计必须等于已认可数量。任一仓库存不足则整单失败。'
                      )}
                    </div>
                    {detail.currentPlan.lines.map(line => (
                      <div key={`alloc-${line.skuId}`} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                            {line.skuCode} · {line.quantity} PCS
                          </span>
                          <button
                            type="button"
                            onClick={() => addAllocationRow(line.skuId, 0)}
                            data-testid={`alloc-add-${line.skuCode}`}
                            className="rounded-lg border border-emerald-300 px-2 py-1 text-[10px] font-semibold"
                          >
                            {text('Add warehouse', '添加仓库')}
                          </button>
                        </div>
                        {(allocations[line.skuId] ?? []).map((row, index) => (
                          <div key={`${line.skuId}-${index}`} className="flex flex-wrap items-center gap-2">
                            <select
                              value={row.warehouseId}
                              onChange={event =>
                                updateAllocation(line.skuId, index, {
                                  warehouseId: event.target.value,
                                })
                              }
                              data-testid={`alloc-warehouse-${line.skuCode}-${index}`}
                              className="h-9 min-w-[150px] rounded-lg border border-emerald-300 px-2"
                            >
                              <option value="">{text('Select warehouse', '选择仓库')}</option>
                              {warehouses.filter(item => item.active).map(warehouse => (
                                <option key={warehouse.id} value={warehouse.id}>
                                  {warehouse.code} · {warehouse.nameEn}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={1}
                              value={row.quantity}
                              onChange={event =>
                                updateAllocation(line.skuId, index, {
                                  quantity: event.target.value,
                                })
                              }
                              data-testid={`alloc-qty-${line.skuCode}-${index}`}
                              className="h-9 w-20 rounded-lg border border-emerald-300 px-2 text-center"
                            />
                            <button
                              type="button"
                              onClick={() => removeAllocationRow(line.skuId, index)}
                              className="rounded-lg border border-emerald-300 px-2 py-1 text-[10px]"
                            >
                              {text('Remove', '移除')}
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void confirmWithAllocations()}
                      data-testid="sales-confirm-submit"
                      className="min-h-[42px] rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {text('Confirm order and reserve stock', '确认订单并预占库存')}
                    </button>
                  </div>
                )}

              {scope === 'sales' &&
                isInternal(detail) &&
                detail.status === 'CONFIRMED' &&
                detail.confirmation?.reservation && (
                  <div
                    data-testid="sales-reservation-actions"
                    className="rounded-xl border border-slate-200 p-3 space-y-3 text-xs"
                  >
                    <div>
                      <div className="font-bold">{text('Request extension', '申请延期')}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={240}
                          value={extensionHours}
                          onChange={event => setExtensionHours(event.target.value)}
                          data-testid="extension-hours"
                          className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-center"
                        />
                        <input
                          value={extensionReason}
                          onChange={event => setExtensionReason(event.target.value)}
                          maxLength={1000}
                          placeholder={text('Reason', '原因')}
                          data-testid="extension-reason"
                          className="h-9 min-w-[180px] flex-1 rounded-lg border border-slate-300 px-2"
                        />
                        <button
                          type="button"
                          disabled={busy || detail.pendingExtensionRequest}
                          onClick={() => void submitExtension()}
                          data-testid="extension-submit"
                          className="min-h-[36px] rounded-lg bg-slate-900 px-3 font-semibold text-white disabled:opacity-50"
                        >
                          {text('Request', '提交')}
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="font-bold">
                        {text('Request full release / exception cancellation', '申请整单释放/异常取消')}
                      </div>
                      <div className="mt-1 space-y-1">
                        <textarea
                          value={releaseReason}
                          onChange={event => setReleaseReason(event.target.value)}
                          maxLength={1000}
                          placeholder={text('Release reason', '释放原因')}
                          data-testid="release-reason"
                          className="w-full rounded-lg border border-slate-300 p-2"
                          rows={2}
                        />
                        <textarea
                          value={verificationNote}
                          onChange={event => setVerificationNote(event.target.value)}
                          maxLength={1000}
                          placeholder={text(
                            'Manual verification note: explicitly confirm unpaid and not shipped',
                            '人工核实说明：必须明确未付款、未出库'
                          )}
                          data-testid="release-verification-note"
                          className="w-full rounded-lg border border-slate-300 p-2"
                          rows={2}
                        />
                        <div className="text-[10px] text-rose-700">
                          {text(
                            'Only a verified unpaid / not-shipped order may use this path. Payment or shipment evidence blocks it.',
                            '仅核实为未付款、未出库的订单可走此路径；已付款或已出库会被拒绝。'
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={busy || detail.pendingReleaseRequest}
                          onClick={() => void submitRelease()}
                          data-testid="release-submit"
                          className="min-h-[36px] rounded-lg border border-rose-300 px-3 font-semibold text-rose-700 disabled:opacity-50"
                        >
                          {text('Submit for approval', '提交审批')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
                  {!detail.currentPlan && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveLines()}
                      className="min-h-[42px] px-4 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
                      data-testid="order-modify-save"
                    >
                      {text('Save quantity changes', '保存数量变更')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    className="min-h-[42px] px-4 rounded-xl border border-rose-300 text-rose-700 text-xs font-bold"
                    data-testid="order-cancel-open"
                  >
                    {text('Cancel order', '取消订单')}
                  </button>
                  <span className="text-[10px] text-slate-500 self-center">
                    {detail.currentPlan
                      ? text(
                          'A plan is active. Reject it or cancel the order to return to sales.',
                          '方案已提交。可拒绝方案或取消订单退回业务员。'
                        )
                      : text(
                          'Only pending-confirmation orders can be changed or cancelled.',
                          '只有待确认订单可以修改或取消。'
                        )}
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
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500">
                  {detail.currentPlan?.status === 'ACCEPTED'
                    ? text(
                        'The buyer accepted the current plan. Use the allocation panel above to confirm.',
                        '采购账号已认可当前方案。请在上方分仓面板中正式确认。'
                      )
                    : text(
                        'Save a complete plan first. A changed price needs business approval before the buyer can accept.',
                        '请先保存完整方案。改价需业务管理员审批后，采购账号才能认可。'
                      )}
                </div>
              )}

              {scope === 'admin' && (
                <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  {text(
                    'Administrator supervision is read-only. Price, extension and release decisions are in the Approvals tab and require the explicit approval permissions.',
                    '管理员监督为只读。价格、延期与释放审批在“审批”页，需显式审批权限。'
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
                <>
                  {notice && (
                    <div
                      role="status"
                      data-testid="order-drawer-notice"
                      className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"
                    >
                      {notice}
                    </div>
                  )}
                  {actionError && detail && (
                    <div
                      role="alert"
                      data-testid="order-drawer-error"
                      className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
                    >
                      {localizedError(actionError)}
                    </div>
                  )}
                  {detailLoading ? (
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
                  )}
                </>
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
