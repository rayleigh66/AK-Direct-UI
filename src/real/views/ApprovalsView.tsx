import React, { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import {
  decideExtensionApproval,
  decidePriceApproval,
  decideReleaseApproval,
  getOrderApproval,
  grantBuyerAuthorization,
  listBuyerAuthorizations,
  listConfirmerAccountCompanies,
  listOrderApprovals,
  revokeBuyerAuthorization,
  runExpiryScan,
} from '../api';
import { usdFromCents } from '../cart';
import type {
  ApprovalDetailDto,
  ApprovalStatus,
  ApprovalSummaryDto,
  ApprovalType,
  BuyerAuthorizationDto,
  ConfirmerAccountCompanyDto,
} from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';
import { SideDrawer } from '../../components/ui/SideDrawer';
import { formatEnglishDate } from '../../utils/dateDisplay';
import { useInternalLanguage } from '../internalLanguage';

const idempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const TYPE_LABELS: Record<ApprovalType, { en: string; zh: string }> = {
  price: { en: 'Price changes', zh: '改价审批' },
  extension: { en: 'Extensions', zh: '延期审批' },
  release: { en: 'Releases', zh: '释放审批' },
};

export const ApprovalsView: React.FC<{
  canApprovePrice: boolean;
  canApproveExtension: boolean;
  canApproveRelease: boolean;
  canManageConfirmers: boolean;
}> = ({ canApprovePrice, canApproveExtension, canApproveRelease, canManageConfirmers }) => {
  const { language } = useInternalLanguage();
  const text = (en: string, zh: string) => (language === 'zh' ? zh : en);
  const availableTypes: ApprovalType[] = [
    ...(canApprovePrice ? (['price'] as const) : []),
    ...(canApproveExtension ? (['extension'] as const) : []),
    ...(canApproveRelease ? (['release'] as const) : []),
  ];
  const [type, setType] = useState<ApprovalType>(availableTypes[0] ?? 'price');
  const [status, setStatus] = useState<ApprovalStatus>('PENDING');
  const [rows, setRows] = useState<ApprovalSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<ApprovalDetailDto | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmerCompanies, setConfirmerCompanies] = useState<ConfirmerAccountCompanyDto[]>([]);
  const [confirmerCompanyId, setConfirmerCompanyId] = useState('');
  const [authorizations, setAuthorizations] = useState<BuyerAuthorizationDto[]>([]);

  const load = () => {
    if (!availableTypes.includes(type)) return;
    setLoading(true);
    setError('');
    listOrderApprovals(type, status)
      .then(setRows)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [type, status]);

  const loadConfirmers = () => {
    if (!canManageConfirmers) return;
    listConfirmerAccountCompanies()
      .then(companies => {
        setConfirmerCompanies(companies);
        setConfirmerCompanyId(previous => previous || companies[0]?.companyId || '');
      })
      .catch((err: Error) => setError(err.message));
  };

  useEffect(loadConfirmers, [canManageConfirmers]);

  const loadAuthorizations = (companyId: string) => {
    if (!canManageConfirmers || !companyId) return;
    listBuyerAuthorizations(companyId)
      .then(setAuthorizations)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    if (confirmerCompanyId) loadAuthorizations(confirmerCompanyId);
  }, [confirmerCompanyId, canManageConfirmers]);

  const openDetail = async (row: ApprovalSummaryDto) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setError('');
    setNote('');
    try {
      setDetail(await getOrderApproval(row.type, row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval detail failed.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const requestValue = (key: string): unknown =>
    detail && typeof detail.request[key] !== 'undefined' ? detail.request[key] : undefined;

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!detail || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (detail.type === 'price') {
        await decidePriceApproval(String(requestValue('id')), {
          decision,
          note: note.trim() || undefined,
          expectedPlanVersion: Number(requestValue('requestedPlanVersion')),
          idempotencyKey: idempotencyKey(),
        });
      } else if (detail.type === 'extension') {
        await decideExtensionApproval(String(requestValue('id')), {
          decision,
          note: note.trim() || undefined,
          expectedReservationVersion: Number(requestValue('expectedReservationVersion')),
          idempotencyKey: idempotencyKey(),
        });
      } else {
        await decideReleaseApproval(String(requestValue('id')), {
          decision,
          note: note.trim() || undefined,
          expectedReservationVersion: Number(requestValue('expectedReservationVersion')),
          idempotencyKey: idempotencyKey(),
        });
      }
      setNotice(
        text(
          decision === 'APPROVED' ? 'Approval recorded and executed.' : 'Request rejected.',
          decision === 'APPROVED' ? '审批已记录并执行。' : '申请已驳回。'
        )
      );
      setDetailOpen(false);
      setDetail(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval decision failed.');
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await runExpiryScan();
      setNotice(
        text(
          `Expiry scan: ${result.expired} expired, ${result.skipped} skipped.`,
          `到期扫描：${result.expired} 条逾期，${result.skipped} 条跳过。`
        )
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Expiry scan failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleAuthorization = async (
    company: ConfirmerAccountCompanyDto,
    account: ConfirmerAccountCompanyDto['accounts'][number]
  ) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (account.activeAuthorizationId) {
        await revokeBuyerAuthorization(
          account.activeAuthorizationId,
          'Revoked from the approval workspace.',
          idempotencyKey()
        );
      } else {
        await grantBuyerAuthorization(company.companyId, account.customerUserId, idempotencyKey());
      }
      loadAuthorizations(company.companyId);
      loadConfirmers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization update failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#ff681e]" />
          <h2 className="text-base font-extrabold">{text('Approvals', '审批')}</h2>
          <span className="text-[11px] text-slate-500">
            {text(
              'Only explicit approval permissions can decide these requests.',
              '仅显式审批权限可以处理这些申请。'
            )}
          </span>
          {canApproveExtension && (
            <button
              type="button"
              onClick={() => void scan()}
              disabled={busy}
              data-testid="expiry-scan"
              className="ml-auto min-h-[38px] rounded-xl border border-slate-300 px-3 text-xs font-semibold disabled:opacity-50"
            >
              <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
              {text('Run expiry scan', '执行到期扫描')}
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {availableTypes.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              data-testid={`approval-tab-${item}`}
              className={`min-h-[36px] rounded-xl px-3 text-xs font-semibold ${
                type === item ? 'bg-slate-900 text-white' : 'border border-slate-300'
              }`}
            >
              {language === 'zh' ? TYPE_LABELS[item].zh : TYPE_LABELS[item].en}
            </button>
          ))}
          <select
            value={status}
            onChange={event => setStatus(event.target.value as ApprovalStatus)}
            className="ml-auto h-9 rounded-xl border border-slate-300 px-2 text-xs"
            data-testid="approval-status-filter"
          >
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}
      {error && <ErrorBlock message={error} onRetry={load} />}
      {loading ? (
        <LoadingBlock label={text('Loading approvals…', '正在加载审批…')} />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {text('No requests in this queue.', '该队列暂无申请。')}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <button
              key={row.id}
              type="button"
              onClick={() => void openDetail(row)}
              data-testid="approval-row"
              data-order-no={row.orderNo}
              className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left text-xs hover:border-slate-300"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{row.orderNo}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">
                  {row.companyCode} · {row.companyShortName}
                </span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  {row.status}
                </span>
                <span className="ml-auto text-slate-500">
                  {formatEnglishDate(row.requestedAt)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-slate-600">
                <span>{row.summary}</span>
                <span className="text-slate-400">
                  {text('requested by', '申请人')} {row.requestedByLabel}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {canManageConfirmers && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
          <h3 className="text-sm font-extrabold">
            {text('Buyer confirmation authority', '采购确认授权')}
          </h3>
          <div className="text-[11px] text-slate-500">
            {text(
              'Grant or revoke a per-account authorization instance. Re-granting never revives an old acceptance.',
              '按账号授予或撤销授权实例。重新授权不会复活旧认可。'
            )}
          </div>
          <select
            value={confirmerCompanyId}
            onChange={event => setConfirmerCompanyId(event.target.value)}
            data-testid="confirmer-company"
            className="h-9 min-w-[240px] rounded-xl border border-slate-300 px-2 text-xs"
          >
            {confirmerCompanies.map(company => (
              <option key={company.companyId} value={company.companyId}>
                {company.customerCode} · {company.shortName}
              </option>
            ))}
          </select>
          {confirmerCompanies
            .filter(company => company.companyId === confirmerCompanyId)
            .flatMap(company =>
              company.accounts.map(account => (
                <div
                  key={account.customerUserId}
                  data-testid="confirmer-account"
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2 text-xs"
                >
                  <span className="font-mono font-semibold">{account.username}</span>
                  <span className="text-slate-500">{account.status}</span>
                  <span className="text-slate-400">
                    {account.activeAuthorizationId
                      ? text('authorized', '已授权')
                      : text('not authorized', '未授权')}
                  </span>
                  <button
                    type="button"
                    disabled={busy || account.status !== 'active'}
                    onClick={() => void toggleAuthorization(company, account)}
                    data-testid={
                      account.activeAuthorizationId
                        ? 'confirmer-revoke'
                        : 'confirmer-grant'
                    }
                    className="ml-auto min-h-[34px] rounded-lg border border-slate-300 px-3 font-semibold disabled:opacity-50"
                  >
                    {account.activeAuthorizationId
                      ? text('Revoke', '撤权')
                      : text('Grant', '授权')}
                  </button>
                </div>
              ))
            )}
          <div className="text-[10px] text-slate-500">
            {text('Active instances', '活动实例')}: {authorizations.filter(item => item.status === 'active').length}
          </div>
        </section>
      )}

      <SideDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onClosed={() => {
          setDetail(null);
          setNote('');
        }}
        title={text('Approval detail', '审批详情')}
        subtitle={detail?.order.orderNo}
        testId="approval-detail-drawer"
        closeTestId="approval-detail-close"
        closeLabel={text('Close', '关闭')}
      >
        {detailLoading ? (
          <LoadingBlock label={text('Loading approval…', '正在加载审批…')} />
        ) : detail ? (
          <div data-testid="approval-detail" className="space-y-3 text-xs">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="font-bold">{detail.order.orderNo}</div>
              <div className="text-slate-500">
                {detail.order.company.customerCode} · {detail.order.company.shortName}
              </div>
              <div className="mt-1">
                {text('Status', '状态')}: {detail.order.status} ·{' '}
                {text('Revision', '版本')} {detail.order.revision}
              </div>
              {detail.order.currentPlan && (
                <div className="mt-2 space-y-1">
                  <div className="font-semibold">
                    {text('Plan', '方案')} v{detail.order.currentPlan.version} ·{' '}
                    {detail.order.currentPlan.status} ·{' '}
                    {detail.order.currentPlan.priceApprovalStatus}
                  </div>
                  {detail.order.currentPlan.lines.map(line => (
                    <div key={line.skuId} className="flex gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate font-mono">{line.skuCode}</span>
                      <span>{line.quantity} PCS</span>
                      <span>{usdFromCents(line.unitPriceCents)} / pc</span>
                      <span className="font-semibold">{usdFromCents(line.lineTotalCents)}</span>
                    </div>
                  ))}
                  <div className="text-right font-bold">
                    {usdFromCents(detail.order.currentPlan.totalCents)}
                  </div>
                </div>
              )}
              {detail.order.confirmation?.reservation && (
                <div className="mt-2 rounded-lg bg-slate-50 p-2">
                  {text('Reservation', '预占')}:{' '}
                  {detail.order.confirmation.reservation.effectiveStatus} ·{' '}
                  {text('expires', '到期')}{' '}
                  {formatEnglishDate(detail.order.confirmation.reservation.expiresAt)}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="font-bold">{text('Request', '申请')}</div>
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-slate-600">
                {JSON.stringify(detail.request, null, 2)}
              </pre>
            </div>
            <textarea
              value={note}
              onChange={event => setNote(event.target.value)}
              maxLength={1000}
              placeholder={text('Decision note (optional)', '审批说明（选填）')}
              data-testid="approval-note"
              className="w-full rounded-xl border border-slate-300 p-2"
              rows={2}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide('APPROVED')}
                data-testid="approval-approve"
                className="min-h-[40px] rounded-xl bg-emerald-600 px-4 font-bold text-white disabled:opacity-50"
              >
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                {text('Approve', '批准')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide('REJECTED')}
                data-testid="approval-reject"
                className="min-h-[40px] rounded-xl border border-rose-300 px-4 font-bold text-rose-700 disabled:opacity-50"
              >
                <XCircle className="mr-1 inline h-4 w-4" />
                {text('Reject', '驳回')}
              </button>
            </div>
          </div>
        ) : (
          <ErrorBlock message={error || text('Approval not found.', '审批不存在。')} />
        )}
      </SideDrawer>
    </div>
  );
};
