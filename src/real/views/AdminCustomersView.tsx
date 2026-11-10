import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Building2,
  CheckCircle2,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  createAdminCompany,
  createCompanyAccount,
  getPendingOrderImpact,
  listAdminBrands,
  listAdminCompanies,
  listCompanyAccounts,
  listCompanyBrandIds,
  listSalesUsers,
  setCompanyBrandGrant,
  setCompanySalesAssignment,
  setCompanyStatus,
  setCustomerStatus,
} from '../api';
import type {
  AdminCustomerAccountDto,
  AdminCustomerCompanyDto,
  AdminSalesUserDto,
  BrandDto,
  OrderImpactDto,
} from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';
import { Localized, useInternalLanguage } from '../internalLanguage';
import { SearchableCombobox } from '../../components/ui/SearchableCombobox';
import { ISO_COUNTRIES, findCountry } from '../../data/isoCountries';
import { formatEnglishDate } from '../../utils/dateDisplay';
import { usdFromCents } from '../cart';

const inputClass =
  'mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff681e]';

type TempCredential = {
  title: string;
  username: string;
  password: string;
  companyId: string;
  companyCode: string;
  companyName: string;
};

type ImpactState = {
  title: string;
  description: string;
  success: string;
  companyId: string;
  preview: OrderImpactDto;
  run: (token?: string) => Promise<unknown>;
};

type PendingAccount = { account: AdminCustomerAccountDto; next: 'active' | 'suspended' };

type CreateForm = {
  customerCode: string;
  shortName: string;
  countryAlpha3: string;
  internalNickname: string;
  assignedSalesUserId: string;
  brandIds: string[];
};

const EMPTY_FORM: CreateForm = {
  customerCode: '',
  shortName: '',
  countryAlpha3: '',
  internalNickname: '',
  assignedSalesUserId: '',
  brandIds: [],
};

export const AdminCustomersView: React.FC<{
  canManageCompanies: boolean;
  canManageAccounts: boolean;
  canManageBrands: boolean;
  canReadCatalog: boolean;
}> = ({ canManageCompanies, canManageAccounts, canManageBrands, canReadCatalog }) => {
  const { t } = useInternalLanguage();
  const [companies, setCompanies] = useState<AdminCustomerCompanyDto[]>([]);
  const [accounts, setAccounts] = useState<AdminCustomerAccountDto[]>([]);
  const [brands, setBrands] = useState<BrandDto[]>([]);
  const [salesUsers, setSalesUsers] = useState<AdminSalesUserDto[]>([]);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminCustomerCompanyDto | null>(null);
  const [salesDraft, setSalesDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  // Credentials are keyed by company so a delayed response cannot appear in
  // another company's context, and are only cleared after the user saves them.
  const [pendingCredentials, setPendingCredentials] = useState<Record<string, TempCredential>>({});
  const [pendingAccount, setPendingAccount] = useState<PendingAccount | null>(null);
  const [impact, setImpact] = useState<ImpactState | null>(null);

  // Every company-detail request is tagged so a slow response for the
  // previously selected company can never overwrite the current selection.
  const detailRequestId = useRef(0);
  const selectedCompanyId = useRef<string | null>(null);
  const accountCreateInFlight = useRef<Set<string>>(new Set());
  const tempCredential = selectedId ? pendingCredentials[selectedId] ?? null : null;

  const canShowBrands = canManageBrands && canReadCatalog;

  const rememberCredential = (
    company: AdminCustomerCompanyDto,
    title: string,
    username: string,
    password: string
  ) => {
    setPendingCredentials(current => ({
      ...current,
      [company.id]: {
        title,
        username,
        password,
        companyId: company.id,
        companyCode: company.customerCode,
        companyName: company.shortName,
      },
    }));
  };

  const closeCredential = (companyId: string) => {
    setPendingCredentials(current => {
      const next = { ...current };
      delete next[companyId];
      return next;
    });
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [companyItems, salesItems, brandItems] = await Promise.all([
        canManageCompanies ? listAdminCompanies() : Promise.resolve([]),
        canManageCompanies ? listSalesUsers() : Promise.resolve([]),
        canShowBrands ? listAdminBrands() : Promise.resolve([]),
      ]);
      setCompanies(companyItems);
      setSalesUsers(salesItems);
      setBrands(brandItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('The request failed.', '请求失败。'));
    } finally {
      setLoading(false);
    }
  };

  // The tab is mounted once per permission set; refresh is explicit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, []);

  const selectCompany = async (company: AdminCustomerCompanyDto) => {
    const requestId = ++detailRequestId.current;
    selectedCompanyId.current = company.id;
    setSelectedId(company.id);
    setDetail(company);
    setSalesDraft(company.assignedSalesUserId ?? '');
    setAccounts([]);
    setBrandIds([]);
    setPendingAccount(null);
    setImpact(null);
    setDetailLoading(true);
    setError('');
    setNotice('');
    try {
      const [accountItems, ids] = await Promise.all([
        canManageAccounts ? listCompanyAccounts(company.id) : Promise.resolve([]),
        canManageBrands ? listCompanyBrandIds(company.id) : Promise.resolve([]),
      ]);
      if (requestId !== detailRequestId.current) return;
      setAccounts(accountItems);
      setBrandIds(ids);
    } catch (err) {
      if (requestId !== detailRequestId.current) return;
      setError(err instanceof Error ? err.message : t('The request failed.', '请求失败。'));
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  };

  const reload = async (companyId: string | null = selectedCompanyId.current) => {
    const requestId = ++detailRequestId.current;
    const list = await listAdminCompanies();
    if (requestId !== detailRequestId.current) return;
    setCompanies(list);
    if (!companyId) return;
    const updated = list.find(company => company.id === companyId);
    if (!updated) {
      setDetail(null);
      setSelectedId(null);
      selectedCompanyId.current = null;
      return;
    }
    setDetail(updated);
    setSalesDraft(updated.assignedSalesUserId ?? '');
    const [accountItems, ids] = await Promise.all([
      canManageAccounts ? listCompanyAccounts(companyId) : Promise.resolve(null),
      canManageBrands ? listCompanyBrandIds(companyId) : Promise.resolve(null),
    ]);
    if (requestId !== detailRequestId.current) return;
    if (accountItems) setAccounts(accountItems);
    if (ids) setBrandIds(ids);
  };

  const run = async (
    action: () => Promise<unknown>,
    success: string,
    companyId: string | null = selectedCompanyId.current
  ) => {
    const contextCompanyId = companyId;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      // Refresh whatever company is selected now; an action for A must not
      // replace B's detail or show A's success message inside B's context.
      await reload();
      if (contextCompanyId && selectedCompanyId.current !== contextCompanyId) return true;
      setNotice(success);
      return true;
    } catch (err) {
      if (contextCompanyId && selectedCompanyId.current !== contextCompanyId) return false;
      setError(err instanceof Error ? err.message : t('The request failed.', '请求失败。'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter(company =>
      `${company.customerCode} ${company.shortName} ${company.internalNickname ?? ''}`
        .toLowerCase()
        .includes(needle)
    );
  }, [companies, search]);

  const salesName = (id?: string) => {
    if (!id) return t('Unassigned', '未分配');
    return salesUsers.find(user => user.id === id)?.name ?? id;
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const customerCode = form.customerCode.trim().toUpperCase();
    const country = findCountry(form.countryAlpha3.trim().toUpperCase());
    if (!/^C[0-9]{6}$/.test(customerCode)) {
      setFormError(t('Customer code must be C followed by six digits.', '客户编号必须是 C 加六位数字。'));
      return;
    }
    if (!form.shortName.trim()) {
      setFormError(t('Enter a customer name.', '请输入客户名称。'));
      return;
    }
    if (!country) {
      setFormError(t('Select a valid country from the ISO alpha-3 list.', '请从 ISO alpha-3 列表选择有效国家。'));
      return;
    }
    setCreateBusy(true);
    setFormError('');
    try {
      const result = await createAdminCompany({
        customerCode,
        shortName: form.shortName.trim(),
        countryAlpha3: country.code,
        internalNickname: form.internalNickname.trim() || undefined,
        assignedSalesUserId: form.assignedSalesUserId || undefined,
        brandIds: form.brandIds,
      });
      rememberCredential(
        result.company,
        t('Customer company created', '客户公司已创建'),
        result.primaryUsername,
        result.temporaryPassword
      );
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setNotice(
        t(
          'Company created. Save the temporary password before closing the dialog.',
          '客户公司已创建。关闭对话框前请保存临时密码。'
        )
      );
      const list = await listAdminCompanies();
      setCompanies(list);
      const created = list.find(company => company.id === result.company.id);
      if (created) await selectCompany(created);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('The request failed.', '请求失败。'));
    } finally {
      setCreateBusy(false);
    }
  };

  const addAccount = async () => {
    if (!detail || busy) return;
    const companyId = detail.id;
    if (accountCreateInFlight.current.has(companyId)) return;
    if (pendingCredentials[companyId]) {
      setError(
        t(
          'Save the existing temporary password before creating another account.',
          '请先保存现有的临时密码，再创建新账号。'
        )
      );
      return;
    }
    accountCreateInFlight.current.add(companyId);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await createCompanyAccount(companyId);
      rememberCredential(
        detail,
        t('Customer account created', '客户账号已创建'),
        result.username,
        result.temporaryPassword
      );
      if (selectedCompanyId.current !== companyId) return;
      const nextAccounts = await listCompanyAccounts(companyId);
      if (selectedCompanyId.current !== companyId) return;
      setAccounts(nextAccounts);
      setNotice(
        t(
          'Account created. Save the temporary password before closing the dialog.',
          '账号已创建。关闭对话框前请保存临时密码。'
        )
      );
    } catch (err) {
      if (selectedCompanyId.current !== companyId) return;
      setError(err instanceof Error ? err.message : t('The request failed.', '请求失败。'));
    } finally {
      accountCreateInFlight.current.delete(companyId);
      setBusy(false);
    }
  };

  const confirmAccountStatus = async () => {
    if (!pendingAccount || !detail) return;
    const { account, next } = pendingAccount;
    setPendingAccount(null);
    await run(
      () => setCustomerStatus(account.id, next),
      next === 'suspended'
        ? t('Account suspended and sessions revoked.', '账号已停用，登录会话已撤销。')
        : t('Account reactivated.', '账号已重新启用。'),
      detail.id
    );
  };

  const requestCompanyStatus = async (company: AdminCustomerCompanyDto, next: 'active' | 'suspended') => {
    if (next === 'suspended') {
      try {
        const preview = await getPendingOrderImpact('company_suspend', company.id);
        if (selectedCompanyId.current !== company.id) return;
        if (preview.affectedOrders.length > 0) {
          setImpact({
            title: t('Suspend company and cancel pending orders', '停用客户并取消待确认订单'),
            description: t(
              'Suspending this company revokes every customer session and cancels the pending-confirmation orders listed below.',
              '停用该客户会撤销所有客户会话，并取消下列待确认订单。'
            ),
            success: t('Company suspended and affected pending orders cancelled.', '客户已停用，受影响的待确认订单已取消。'),
            companyId: company.id,
            preview,
            run: token =>
              setCompanyStatus(company.id, 'suspended', {
                confirmAffectedOrders: true,
                impactToken: token,
              }),
          });
          return;
        }
      } catch (err) {
        if (selectedCompanyId.current !== company.id) return;
        setError(err instanceof Error ? err.message : t('The request failed.', '请求失败。'));
        return;
      }
    }
    await run(
      () => setCompanyStatus(company.id, next),
      next === 'suspended'
        ? t('Company suspended and sessions revoked.', '客户已停用，登录会话已撤销。')
        : t('Company reactivated.', '客户已重新启用。'),
      company.id
    );
  };

  const requestBrand = async (brand: BrandDto, granted: boolean) => {
    if (!detail || busy) return;
    const companyId = detail.id;
    if (granted) {
      await run(
        () => setCompanyBrandGrant(companyId, brand.id, true),
        t('Brand access granted.', '品牌授权已添加。'),
        companyId
      );
      return;
    }
    try {
      const preview = await getPendingOrderImpact('brand_revoke', brand.id, companyId);
      if (selectedCompanyId.current !== companyId) return;
      if (preview.affectedOrders.length > 0) {
        setImpact({
          title: t('Revoke brand and cancel pending orders', '撤销品牌授权并取消待确认订单'),
          description: t(
            'Revoking this brand removes it from the customer catalogue and cancels the pending-confirmation orders listed below.',
            '撤销该品牌后，客户目录将不再显示该品牌，并取消下列待确认订单。'
          ),
          success: t('Brand access revoked and affected pending orders cancelled.', '品牌授权已撤销，受影响的待确认订单已取消。'),
          companyId,
          preview,
          run: token =>
            setCompanyBrandGrant(companyId, brand.id, false, {
              confirmAffectedOrders: true,
              impactToken: token,
            }),
        });
        return;
      }
    } catch (err) {
      if (selectedCompanyId.current !== companyId) return;
      setError(err instanceof Error ? err.message : t('The request failed.', '请求失败。'));
      return;
    }
    await run(
      () => setCompanyBrandGrant(companyId, brand.id, false),
      t('Brand access revoked.', '品牌授权已撤销。'),
      companyId
    );
  };

  const confirmImpact = async () => {
    if (!impact) return;
    const current = impact;
    setImpact(null);
    await run(
      () => current.run(current.preview.impactToken),
      current.success,
      current.companyId
    );
  };

  const otherCredentials = Object.values(pendingCredentials).filter(
    credential => credential.companyId !== selectedId
  );

  if (loading) return <LoadingBlock label={t('Loading customers…', '正在加载客户…')} />;

  return (
    <Localized>
      <div className="space-y-4" data-testid="admin-customers">
        {error && <ErrorBlock message={error} onRetry={() => void load()} />}
        {notice && (
          <div
            data-testid="admin-notice"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"
          >
            {notice}
          </div>
        )}
        {otherCredentials.length > 0 && (
          <div
            data-testid="pending-credential-banner"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
          >
            <span className="font-semibold">
              {t('Temporary credentials are waiting for:', '以下客户有待保存的临时凭据：')}
            </span>
            <span className="ml-2 inline-flex flex-wrap gap-1.5">
              {otherCredentials.map(credential => (
                <button
                  key={credential.companyId}
                  type="button"
                  onClick={() => {
                    const company = companies.find(item => item.id === credential.companyId);
                    if (company) void selectCompany(company);
                  }}
                  className="rounded-full border border-amber-300 bg-white px-2 py-0.5 font-mono font-bold"
                >
                  {credential.companyCode}
                </button>
              ))}
            </span>
          </div>
        )}

        <section className="fo-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[var(--orange-pale)] text-[var(--orange-deep)]">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="fo-page-title text-xl">{t('Customer companies', '客户公司管理')}</h1>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                {t(
                  'Create real customer companies, accounts, brand access and sales assignment. Every change is written through the API and the existing permissions.',
                  '创建真实客户公司、账号、品牌授权与业务员归属。所有变更均通过 API 与现有权限写入。'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCreateOpen(value => !value);
                setFormError('');
              }}
              data-testid="customer-company-new"
              className="fo-btn fo-btn-primary flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> {t('New company', '新建客户')}
            </button>
          </div>
          <label className="mt-3 flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={t('Search customer code or name', '搜索客户编号或名称')}
              data-testid="customer-company-search"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </label>
        </section>

        {createOpen && (
          <form
            data-testid="company-create-form"
            onSubmit={submitCreate}
            className="fo-card grid gap-3 p-4 sm:grid-cols-2 sm:p-5"
          >
            <label className="text-xs font-semibold text-slate-700">
              {t('Customer code', '客户编号')}
              <input
                value={form.customerCode}
                onChange={event => setForm(current => ({ ...current, customerCode: event.target.value }))}
                placeholder="C150016"
                data-testid="company-code"
                className={`${inputClass} font-mono`}
                required
              />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              {t('Customer name', '客户名称')}
              <input
                value={form.shortName}
                onChange={event => setForm(current => ({ ...current, shortName: event.target.value }))}
                data-testid="company-short-name"
                className={inputClass}
                required
              />
            </label>
            <div className="text-xs font-semibold text-slate-700">
              {t('Country (ISO alpha-3)', '国家（ISO alpha-3）')}
              <SearchableCombobox
                options={ISO_COUNTRIES.map(country => ({
                  value: country.code,
                  label: `${country.code} — ${country.nameEn}`,
                  keywords: `${country.code} ${country.code2} ${country.nameEn}`,
                }))}
                value={form.countryAlpha3}
                onChange={value => setForm(current => ({ ...current, countryAlpha3: value }))}
                ariaLabel={t('Country (ISO alpha-3)', '国家（ISO alpha-3）')}
                placeholder={t('Search by English name or ISO3 code', '按英文名或 ISO3 搜索')}
                emptyText={t('No matching country', '没有匹配国家')}
                testId="company-country"
                clearOnUnselectedQuery
                className="mt-1"
              />
            </div>
            <label className="text-xs font-semibold text-slate-700">
              {t('Internal nickname (optional)', '内部简称（选填）')}
              <input
                value={form.internalNickname}
                onChange={event => setForm(current => ({ ...current, internalNickname: event.target.value }))}
                data-testid="company-nickname"
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              {t('Assigned salesperson', '归属业务员')}
              <select
                value={form.assignedSalesUserId}
                onChange={event =>
                  setForm(current => ({ ...current, assignedSalesUserId: event.target.value }))
                }
                data-testid="company-sales"
                className={inputClass}
              >
                <option value="">{t('Unassigned', '未分配')}</option>
                {salesUsers.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.email}
                  </option>
                ))}
              </select>
            </label>
            {canShowBrands && (
              <div className="sm:col-span-2">
                <div className="text-xs font-semibold text-slate-700">{t('Brand access', '品牌授权')}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {brands.map(brand => (
                    <label
                      key={brand.id}
                      className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-[11px]"
                    >
                      <input
                        type="checkbox"
                        data-testid={`company-brand-${brand.id}`}
                        checked={form.brandIds.includes(brand.id)}
                        disabled={!brand.active}
                        onChange={event =>
                          setForm(current => ({
                            ...current,
                            brandIds: event.target.checked
                              ? [...current.brandIds, brand.id]
                              : current.brandIds.filter(id => id !== brand.id),
                          }))
                        }
                      />
                      {brand.nameEn}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {formError && (
              <div role="alert" className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                {formError}
              </div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={createBusy} data-testid="company-create-submit" className="fo-btn fo-btn-primary">
                {createBusy ? t('Creating…', '正在创建…') : t('Create company', '创建客户')}
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="fo-btn"
              >
                {t('Cancel', '取消')}
              </button>
            </div>
          </form>
        )}

        <div className="grid min-w-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="fo-card overflow-hidden" data-testid="customer-company-list">
            <div className="border-b border-[var(--line)] p-3 text-xs font-bold">
              {t('Companies', '客户公司')} · {visible.length}
            </div>
            <div className="max-h-[70vh] divide-y divide-[var(--line)] overflow-y-auto">
              {visible.map(company => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => void selectCompany(company)}
                  data-testid="customer-company-row"
                  data-customer-code={company.customerCode}
                  className={`flex w-full flex-col gap-1 p-3 text-left text-xs transition-colors ${
                    selectedId === company.id ? 'bg-[var(--orange-pale)]' : 'hover:bg-[var(--subtle-bg)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{company.customerCode}</span>
                    <span className="truncate font-semibold">{company.shortName}</span>
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        company.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {company.status === 'active' ? t('Active', '启用') : t('Suspended', '已停用')}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {company.countryAlpha3} · {salesName(company.assignedSalesUserId)}
                  </div>
                </button>
              ))}
              {!visible.length && (
                <div className="p-6 text-center text-xs text-[var(--muted)]">
                  {t('No customer companies found.', '没有找到客户公司。')}
                </div>
              )}
            </div>
          </section>

          <section className="min-w-0 space-y-4" data-testid="customer-company-detail">
            {!detail ? (
              <div className="fo-card p-8 text-center text-sm text-[var(--muted)]">
                {t('Select a company to manage its accounts and access.', '选择客户公司以管理账号与权限。')}
              </div>
            ) : (
              <>
                <div className="fo-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[var(--subtle-bg)] text-[var(--ink)]">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-extrabold">{detail.customerCode}</div>
                      <div className="text-base font-bold">{detail.shortName}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                        <span>
                          {detail.countryAlpha3}
                          {detail.internalNickname ? ` · ${detail.internalNickname}` : ''} ·{' '}
                          {formatEnglishDate(detail.createdAt)}
                        </span>
                        <span
                          data-testid="company-status"
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            detail.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {detail.status === 'active' ? t('Active', '启用') : t('Suspended', '已停用')}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detail.status === 'active' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void requestCompanyStatus(detail, 'suspended')}
                          data-testid="company-status-toggle"
                          className="fo-btn flex items-center gap-1.5 text-rose-700"
                        >
                          <Ban className="h-3.5 w-3.5" /> {t('Suspend company', '停用客户')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void requestCompanyStatus(detail, 'active')}
                          data-testid="company-status-toggle"
                          className="fo-btn flex items-center gap-1.5 text-emerald-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t('Reactivate company', '重新启用客户')}
                        </button>
                      )}
                    </div>
                  </div>
                  {detail.status === 'suspended' && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
                      {t('Suspended companies cannot sign in. Reactivate to restore access.', '已停用客户无法登录；重新启用后恢复访问。')}
                    </div>
                  )}
                </div>

                <div className="fo-card p-4 sm:p-5" data-testid="company-sales-assignment">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-[var(--orange-deep)]" />
                    <h2 className="text-sm font-bold">{t('Salesperson assignment', '业务员归属')}</h2>
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="min-w-[220px] flex-1 text-xs font-semibold text-slate-700">
                      {t('Assigned salesperson', '归属业务员')}
                      <select
                        value={salesDraft}
                        onChange={event => setSalesDraft(event.target.value)}
                        data-testid="company-sales-select"
                        className={inputClass}
                      >
                        <option value="">{t('Unassigned', '未分配')}</option>
                        {salesUsers.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.name} · {user.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || (detail.assignedSalesUserId ?? '') === salesDraft}
                      onClick={() =>
                        void run(
                          () => setCompanySalesAssignment(detail.id, salesDraft || null),
                          t('Sales assignment saved.', '业务员归属已保存。'),
                          detail.id
                        )
                      }
                      data-testid="company-sales-save"
                      className="fo-btn fo-btn-dark"
                    >
                      {t('Save assignment', '保存归属')}
                    </button>
                  </div>
                </div>

                <div className="fo-card p-4 sm:p-5" data-testid="company-accounts">
                  <div className="flex flex-wrap items-center gap-2">
                    <Users className="h-4 w-4 text-[var(--orange-deep)]" />
                    <h2 className="text-sm font-bold">{t('Customer accounts', '客户账号')}</h2>
                    <span className="text-[11px] text-[var(--muted)]">
                      {canManageAccounts
                        ? t(`${accounts.length} accounts`, `${accounts.length} 个账号`)
                        : t('Account management permission required.', '需要账号管理权限。')}
                    </span>
                    {canManageAccounts && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addAccount()}
                        data-testid="company-add-account"
                        className="fo-btn ml-auto flex items-center gap-1.5"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> {t('Add account', '新增账号')}
                      </button>
                    )}
                  </div>
                  {detailLoading ? (
                    <LoadingBlock label={t('Loading accounts…', '正在加载账号…')} />
                  ) : canManageAccounts ? (
                    <div className="mt-3 divide-y divide-[var(--line)]">
                      {accounts.map(account => (
                        <div
                          key={account.id}
                          data-testid="customer-account-row"
                          data-username={account.username}
                          className="flex flex-wrap items-center gap-2 py-2 text-xs"
                        >
                          <span className="font-mono font-bold">{account.username}</span>
                          <span className="text-[10px] text-[var(--muted)]">
                            {t('Account', '账号')} {account.accountLetter}
                          </span>
                          <span
                            data-testid="account-status"
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              account.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {account.status === 'active' ? t('Active', '启用') : t('Suspended', '已停用')}
                          </span>
                          {account.mustChangePassword && (
                            <span className="text-[10px] text-amber-700">
                              {t('Password change pending', '待修改密码')}
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setPendingAccount({
                                account,
                                next: account.status === 'active' ? 'suspended' : 'active',
                              })
                            }
                            data-testid="customer-account-toggle"
                            className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-semibold"
                          >
                            {account.status === 'active' ? t('Suspend', '停用') : t('Reactivate', '启用')}
                          </button>
                        </div>
                      ))}
                      {!accounts.length && (
                        <div className="py-3 text-xs text-[var(--muted)]">
                          {t('No accounts yet.', '暂无账号。')}
                        </div>
                      )}
                      {pendingAccount && (
                        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex-1">
                              {pendingAccount.next === 'suspended'
                                ? t(
                                    `Suspend ${pendingAccount.account.username}? Its sessions will be revoked.`,
                                    `停用 ${pendingAccount.account.username}？其登录会话将被撤销。`
                                  )
                                : t(
                                    `Reactivate ${pendingAccount.account.username}?`,
                                    `重新启用 ${pendingAccount.account.username}？`
                                  )}
                            </span>
                            <button
                              type="button"
                              onClick={() => void confirmAccountStatus()}
                              data-testid="customer-account-confirm"
                              className="rounded-lg bg-rose-600 px-2 py-1 font-bold text-white"
                            >
                              {t('Confirm', '确认')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingAccount(null)}
                              className="rounded-lg border border-rose-300 px-2 py-1 font-semibold"
                            >
                              {t('Cancel', '取消')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {t('You do not have permission to manage accounts.', '你没有账号管理权限。')}
                    </p>
                  )}
                </div>

                <div className="fo-card p-4 sm:p-5" data-testid="company-brands">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-[var(--orange-deep)]" />
                    <h2 className="text-sm font-bold">{t('Brand access', '品牌授权')}</h2>
                  </div>
                  {canShowBrands ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {brands.map(brand => (
                        <label
                          key={brand.id}
                          className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-[11px]"
                        >
                          <input
                            type="checkbox"
                            data-testid={`customer-brand-${brand.id}`}
                            checked={brandIds.includes(brand.id)}
                            disabled={busy || !brand.active}
                            onChange={event => void requestBrand(brand, event.target.checked)}
                          />
                          <span>{brand.nameEn}</span>
                          {!brand.active && (
                            <span className="text-[9px] text-[var(--muted)]">{t('Inactive', '停用')}</span>
                          )}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {t(
                        'Brand management requires brands.manage and catalog.read.',
                        '品牌管理需要 brands.manage 与 catalog.read 权限。'
                      )}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {tempCredential && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tempCredential.title}
            data-testid="temp-credential"
            className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-4"
          >
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-extrabold">{tempCredential.title}</h2>
                <button
                  type="button"
                  aria-label={t('Close', '关闭')}
                  onClick={() => closeCredential(tempCredential.companyId)}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-xs text-rose-700">
                {t(
                  'This temporary password is shown once. Save it now; it is not stored in the browser.',
                  '临时密码只显示一次，请立即保存；浏览器不会保存该密码。'
                )}
              </p>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <dt className="text-[10px] text-slate-500">{t('Company', '客户公司')}</dt>
                  <dd
                    className="mt-0.5 font-mono font-bold"
                    data-testid="temp-credential-company"
                  >
                    {tempCredential.companyCode} · {tempCredential.companyName}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <dt className="text-[10px] text-slate-500">{t('Login', '登录名')}</dt>
                  <dd className="mt-0.5 font-mono font-bold" data-testid="temp-credential-username">
                    {tempCredential.username}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <dt className="text-[10px] text-slate-500">{t('Temporary password', '临时密码')}</dt>
                  <dd className="mt-0.5 break-all font-mono font-bold" data-testid="temp-credential-password">
                    {tempCredential.password}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      `${tempCredential.username}\n${tempCredential.password}`
                    );
                  }}
                  className="fo-btn"
                >
                  {t('Copy login and password', '复制登录名与密码')}
                </button>
                <button
                  type="button"
                  onClick={() => closeCredential(tempCredential.companyId)}
                  data-testid="temp-credential-close"
                  className="fo-btn fo-btn-dark"
                >
                  {t('I have saved it', '我已保存')}
                </button>
              </div>
            </div>
          </div>
        )}

        {impact && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={impact.title}
            data-testid="customer-impact-dialog"
            className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-4"
          >
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
              <h2 className="text-base font-extrabold text-rose-700">{impact.title}</h2>
              <p className="mt-2 text-xs text-slate-600">{impact.description}</p>
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                {impact.preview.affectedOrders.map(order => (
                  <div
                    key={order.id}
                    className="flex flex-wrap gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800"
                  >
                    <span className="font-mono font-bold">{order.orderNo}</span>
                    <span>{order.companyCode}</span>
                    <span className="ml-auto">{usdFromCents(order.referenceTotalCents)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setImpact(null)} data-testid="customer-impact-cancel" className="fo-btn">
                  {t('Keep current state', '保持当前状态')}
                </button>
                <button
                  type="button"
                  onClick={() => void confirmImpact()}
                  data-testid="customer-impact-confirm"
                  className="fo-btn bg-rose-600 text-white"
                >
                  {t('Confirm and continue', '确认并继续')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Localized>
  );
};
