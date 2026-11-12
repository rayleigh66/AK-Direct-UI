/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { SearchableCombobox } from '../ui/SearchableCombobox';
import { SelectAllOnFocusInput } from '../ui/SelectAllOnFocusInput';
import { TierBadge } from '../ui/TierBadge';
import { ISO_COUNTRIES, countrySearchText } from '../../data/isoCountries';
import {
  Building2,
  UserPlus,
  KeyRound,
  ShieldAlert,
  Copy,
  CheckCircle2,
  Lock,
  Users,
  Check,
  AlertCircle,
  FastForward,
} from 'lucide-react';

export const CompanyAccountsView: React.FC = () => {
  const {
    currentRole,
    companies,
    customerUsers,
    tierRules,
    brands,
    brandGrants,
    adminCreateCompany,
    adminCreateSecondaryAccount,
    adminToggleBrandGrant,
    simulateTimeTravelInactivity,
  } = useApp();

  // Form states
  const [customerCode, setCustomerCode] = useState('C000888');
  const [shortName, setShortName] = useState('Nordic Travel Gear AS');
  const [countryAlpha3, setCountryAlpha3] = useState('NOR');
  const countryOptions = ISO_COUNTRIES.map(country => ({
    value: country.code,
    label: `${country.code} — ${country.nameEn} / ${country.nameZh}`,
    keywords: countrySearchText(country),
  }));
  const [internalNickname, setInternalNickname] = useState('北欧挪威核心分销');

  // Security Credentials Dialog
  const [createdCredential, setCreatedCredential] = useState<{
    companyName: string;
    username: string;
    tempPassword: string;
    customerCode: string;
  } | null>(null);

  const [copyFeedback, setCopyFeedback] = useState(false);
  const [formError, setFormError] = useState('');
  const [qaCompanyId, setQaCompanyId] = useState(companies[0]?.id ?? '');
  const [qaMessage, setQaMessage] = useState('');

  // RBAC Check (PRD D24 / T27)
  const isSalesperson = currentRole === 'sales';

  const handleCreateCompanySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const res = adminCreateCompany({
      customerCode,
      shortName,
      countryAlpha3,
      internalNickname,
    });

    if (res.success && res.primaryUsername && res.tempPassword) {
      setCreatedCredential({
        companyName: shortName,
        username: res.primaryUsername,
        tempPassword: res.tempPassword,
        customerCode,
      });
      // clear form
      setCustomerCode(`C000${Math.floor(100 + Math.random() * 900)}`);
      setShortName('');
      setInternalNickname('');
    } else {
      setFormError(res.error || '创建失败');
    }
  };

  const handleCreateSecondary = (companyId: string) => {
    const comp = companies.find(c => c.id === companyId);
    if (!comp) return;
    const res = adminCreateSecondaryAccount(companyId);
    if (res.success && res.username && res.tempPassword) {
      setCreatedCredential({
        companyName: comp.short_name,
        username: res.username,
        tempPassword: res.tempPassword,
        customerCode: comp.customer_code,
      });
    } else {
      alert(res.error);
    }
  };

  const copyCredentials = () => {
    if (!createdCredential) return;
    const text = `【AOKING Direct 采购账户开通通知】\n公司: ${createdCredential.companyName} (${createdCredential.customerCode})\n登录账号: ${createdCredential.username}\n一次性临时密码: ${createdCredential.tempPassword}\n安全提示：首次登录必须修改正式密码。请妥善保管凭据。`;
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2500);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-10">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-slate-900">
          客户公司与登录账户建档 (Clients & Accounts Management)
        </h1>
        <p className="text-xs text-slate-500">
          PRD 9.1 两步建档规范 · 用户名规则 AK + 6位客户号 + A-Z · 一次性临时密码机制
        </p>
      </div>

      {/* RBAC Violation Notice for Sales (Scenario T27) */}
      {isSalesperson && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-xs text-rose-900 leading-relaxed">
          <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <strong>RBAC 权限边界拦截 (PRD D24 / T27):</strong> 当前登录角色为【业务员】。
            业务员<strong>无权创建客户公司或登录账户</strong>，以防业务员私自开户或跳过合规审查。
            客户建档与重置密码仅由业务管理员统一操作办理。
          </div>
        </div>
      )}

      {/* 2-Step Onboarding Form (Admin Only) */}
      {!isSalesperson && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Building2 className="w-5 h-5 text-slate-900" />
            <h2 className="text-sm font-bold text-slate-900">
              两步创建客户公司与首位登录账号 (Step 1 & Step 2)
            </h2>
          </div>

          <form onSubmit={handleCreateCompanySubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  内部客户编号 (必填, C+6位)
                </label>
                <SelectAllOnFocusInput
                  type="text"
                  value={customerCode}
                  onChange={e => setCustomerCode(e.target.value.toUpperCase())}
                  placeholder="例如 C000123"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 font-mono text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  required
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">必须符合 ^C[0-9]{'{6}'}$</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  公司商业简称 (必填)
                </label>
                <SelectAllOnFocusInput
                  type="text"
                  value={shortName}
                  onChange={e => setShortName(e.target.value)}
                  placeholder="例如 Apex Luggage Co."
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  国家/地区 (ISO 3166-1 Alpha-3)
                </label>
                <SearchableCombobox
                  options={countryOptions}
                  value={countryAlpha3}
                  onChange={setCountryAlpha3}
                  ariaLabel="搜索并选择客户国家或地区"
                  placeholder="搜索中文名、英文名或三位代码"
                  emptyText="没有匹配的国家或地区"
                  testId="company-country-combobox"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  支持中文、英文名称与三位代码检索
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  内部专属昵称 (选填, 仅内部可见)
                </label>
                <SelectAllOnFocusInput
                  type="text"
                  value={internalNickname}
                  onChange={e => setInternalNickname(e.target.value)}
                  placeholder="例如 重点战略总代"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-xs bg-slate-50 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">绝不展示给客户</span>
              </div>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="min-h-[44px] px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 shadow-sm"
              >
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>立即建档并自动生成 AK 账号与临时密码</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Companies & Accounts Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-700" />
            <span className="text-xs font-bold text-slate-900">已建档客户公司与独立账号列表</span>
          </div>
          <span className="text-xs text-slate-400">同公司共享订单、等级与品牌授权 (PRD D02)</span>
        </div>

        <div className="divide-y divide-slate-100">
          {companies.map(comp => {
            const accounts = customerUsers.filter(u => u.company_id === comp.id);
            const myGrants = brandGrants.filter(g => g.company_id === comp.id);
            const tier = tierRules.find(rule => rule.id === comp.tier_id);

            return (
              <div key={comp.id} className="p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        {comp.customer_code}
                      </span>
                      <TierBadge tier={tier} testId={`company-tier-${comp.customer_code}`} />
                      <span className="font-bold text-slate-900 text-sm">
                        {comp.short_name}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-mono font-semibold">
                        {comp.country_alpha3}
                      </span>
                      {comp.internal_nickname && (
                        <span className="text-xs text-indigo-700 font-medium bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                          内部备注: {comp.internal_nickname}
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-500 flex items-center gap-3">
                      <span>累计采购: <strong className="font-mono text-slate-900">${comp.cumulative_spend_usd.toLocaleString()}</strong></span>
                      <span>·</span>
                      <span>未采购月数: {comp.months_inactive} 个月</span>
                      <span>·</span>
                      <span>建档日期: {comp.created_at}</span>
                    </div>
                  </div>

                  {!isSalesperson && (
                    <button
                      onClick={() => handleCreateSecondary(comp.id)}
                      className="px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors self-start md:self-auto"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-slate-600" />
                      <span>为该公司新增登录账号 (Add Account)</span>
                    </button>
                  )}
                </div>

                {/* Sub-Accounts Strip */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-500">
                    公司名下登录账号 (共享等级与平台订单):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {accounts.map(acc => (
                      <div
                        key={acc.id}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-semibold text-slate-800 flex items-center gap-2 shadow-2xs"
                      >
                        <span>{acc.username}</span>
                        {acc.must_change_password ? (
                          <span className="text-[10px] text-amber-600 font-sans font-normal">(首次登录需改密)</span>
                        ) : (
                          <span className="text-[10px] text-emerald-600 font-sans font-normal">● 正常</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Brand Grants Toggles (D03 & T22) */}
                <div className="flex items-center gap-3 text-xs pt-1">
                  <span className="text-slate-500">品牌分销授权 (Brand Grants):</span>
                  <div className="flex items-center gap-2">
                    {brands.map(b => {
                      const isGranted = myGrants.some(g => g.brand_id === b.id);
                      return (
                        <button
                          key={b.id}
                          disabled={isSalesperson}
                          onClick={() => adminToggleBrandGrant(comp.id, b.id)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                            isGranted
                              ? 'bg-slate-900 text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {isGranted && <Check className="w-3 h-3 text-emerald-400" />}
                          <span>{b.name}</span>
                          <span className="text-[10px] opacity-70">
                            {isGranted ? '已授权' : '未授权'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Internal QA only: inactivity simulation was removed from the customer membership page. */}
      {currentRole === 'admin' && (
        <div
          className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 shadow-sm"
          data-testid="tier-qa-panel"
        >
          <div className="flex items-center gap-2">
            <FastForward className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Demo QA：客户未采购计时模拟</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
              仅内部 QA
            </span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            前端 Mock，不是真实等级变更，不对客户展示。正式系统应由后台按最后有效采购日期计算。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={qaCompanyId}
              onChange={event => setQaCompanyId(event.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs"
              aria-label="QA company"
            >
              {companies.map(company => (
                <option key={company.id} value={company.id}>
                  {company.customer_code} — {company.short_name}
                </option>
              ))}
            </select>
            {[6, 12, 18, 30].map(months => (
              <button
                key={months}
                type="button"
                onClick={() => {
                  const result = simulateTimeTravelInactivity(qaCompanyId, months);
                  setQaMessage(
                    result.success
                      ? `已将 ${qaCompanyId} 的未采购计时 +${months} 个月（Demo）。`
                      : result.error ?? '模拟失败。'
                  );
                }}
                className="min-h-[40px] px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
              >
                +{months} months
              </button>
            ))}
          </div>
          {qaMessage && (
            <div role="status" className="p-2.5 rounded-lg bg-slate-50 text-xs text-slate-700">
              {qaMessage}
            </div>
          )}
        </div>
      )}

      {/* One-Time Temporary Password Display Modal (PRD D26, T28, T29) */}
      {createdCredential && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold">账号已成功生成 · 一次性临时密码</h3>
              </div>
              <button onClick={() => setCreatedCredential(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
                <strong>PRD D26 一次性展示安全要求:</strong> 临时密码由密码学安全随机源生成，
                系统仅在创建/重置时<strong>展示一次</strong>；后台采用单向哈希存储，管理员不可再次查看。
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">客户公司:</span>
                  <span className="font-semibold text-slate-900">{createdCredential.companyName} ({createdCredential.customerCode})</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">系统登录用户名:</span>
                  <span className="font-mono font-bold text-base text-slate-900">{createdCredential.username}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                  <span className="text-slate-400">一次性临时密码:</span>
                  <span className="font-mono font-extrabold text-base text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                    {createdCredential.tempPassword}
                  </span>
                </div>
              </div>

              {copyFeedback && (
                <div className="p-2 bg-emerald-50 text-emerald-800 text-xs rounded-xl flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>开户通知与临时凭据已复制至剪贴板！</span>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={copyCredentials}
                  className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 flex items-center justify-center gap-2 shadow-sm"
                >
                  <Copy className="w-4 h-4" />
                  <span>复制账号与临时密码通知</span>
                </button>
                <button
                  onClick={() => setCreatedCredential(null)}
                  className="px-4 h-11 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
