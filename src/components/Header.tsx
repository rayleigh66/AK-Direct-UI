/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldAlert,
  Smartphone,
  Monitor,
  CheckCircle2,
  Bell,
  ChevronDown,
  UserCheck,
  Building2,
  FileCheck,
  ShoppingCart,
} from 'lucide-react';

interface HeaderProps {
  onOpenTestMatrix: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTestMatrix }) => {
  const {
    currentRole,
    currentCustomerUser,
    currentCompany,
    currentSalesUser,
    currentAdminUser,
    switchRole,
    isMobileSimulator,
    toggleMobileSimulator,
    unreadNotificationCount,
    cart,
    setActiveTab,
  } = useApp();

  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      {/* Top Compliance & Privacy Banner */}
      <div className="bg-slate-900 text-slate-200 px-3 py-1.5 text-xs flex flex-wrap items-center justify-between gap-2 border-b border-slate-800">
        <div className="flex items-center gap-2 truncate">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-medium text-amber-300">AOKING Direct v0.3 原型验证</span>
          <span className="text-slate-400 hidden sm:inline">·</span>
          <span className="text-slate-300 truncate text-[11px] sm:text-xs">
            严格隐私保护：平台不收集/存储客户电话、邮箱与街道地址 · 现货订购申请与人工确认流程
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <button
            onClick={onOpenTestMatrix}
            className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 rounded text-[11px] font-medium transition-colors"
          >
            <FileCheck className="w-3 h-3" />
            <span>验收场景 (T01-T35)</span>
          </button>
          <button
            onClick={toggleMobileSimulator}
            className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white px-2 py-0.5 rounded bg-slate-800 transition-colors"
            title="切换移动端视口模拟"
          >
            {isMobileSimulator ? (
              <>
                <Monitor className="w-3 h-3 text-cyan-400" />
                <span className="hidden sm:inline">宽屏视角</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3 h-3 text-cyan-400" />
                <span className="hidden sm:inline">手机视角</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Top Bar adhering to Section 2 Top Bar Contract */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Zone 1: Single Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab('catalog')}>
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white font-black text-sm flex items-center justify-center tracking-tighter shadow-sm">
              AK
            </div>
            <span className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
              AOKING Direct
            </span>
          </div>
          <span className="text-[11px] text-slate-400 hidden md:inline">
            / B2B Spot Wholesale
          </span>
        </div>

        {/* Zone 2: Navigation Links (single-line, clean text links) */}
        <nav className="hidden lg:flex items-center gap-6 text-xs font-semibold text-slate-600">
          {currentRole === 'customer' ? (
            <>
              <button
                onClick={() => setActiveTab('catalog')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                现货商城 (Catalog)
              </button>
              <button
                onClick={() => setActiveTab('cart')}
                data-testid="header-order-list"
                className="relative flex items-center gap-1.5 hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                <ShoppingCart className="w-4 h-4" aria-hidden="true" />
                <span>订购清单 (Order List)</span>
                {cart.reduce((sum, item) => sum + item.quantity, 0) > 0 && (
                  <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-[#ff681e] px-1 text-[9px] font-bold leading-none text-white">
                    {cart.reduce((sum, item) => sum + item.quantity, 0) > 99
                      ? '99+'
                      : cart.reduce((sum, item) => sum + item.quantity, 0)}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('orders')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                我的订单 (My Orders)
              </button>
              <button
                onClick={() => setActiveTab('membership')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                会员与等级 (Membership)
              </button>
            </>
          ) : currentRole === 'sales' ? (
            <>
              <button
                onClick={() => setActiveTab('sales_orders')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                订单核准与锁库 (Orders)
              </button>
              <button
                onClick={() => setActiveTab('restock_manage')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                客户补货需求 (Restock)
              </button>
              <button
                onClick={() => setActiveTab('internal_mailbox')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                业务员内部邮箱模板 (Mailbox)
              </button>
              <button
                onClick={() => setActiveTab('inventory_import')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                多仓库存查看 (Inventory)
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setActiveTab('admin_companies')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                客户公司与账户建档 (Clients & Accounts)
              </button>
              <button
                onClick={() => setActiveTab('inventory_import')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                库存与 Excel 导入 (Stock & Import)
              </button>
              <button
                onClick={() => setActiveTab('promo_tier')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                等级与促销配置 (Tiers & Promo)
              </button>
              <button
                onClick={() => setActiveTab('audit_logs')}
                className="hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                审计日志 (Audit Trails)
              </button>
            </>
          )}
        </nav>

        {/* Zone 3: 1 Primary Contextual Action & Role Switcher */}
        <div className="flex items-center gap-3 shrink-0">
          {currentRole === 'customer' && (
            <button
              onClick={() => setActiveTab('notifications')}
              className="relative p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
              title="站内通知"
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
              )}
            </button>
          )}

          {/* Interactive Role Switcher Menu */}
          <div className="relative">
            <button
              onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
              className="flex items-center gap-2 pl-3 pr-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 text-xs font-medium text-slate-800 transition-colors"
            >
              <div className="text-left max-w-[130px] sm:max-w-[160px] truncate">
                <div className="font-semibold truncate">
                  {currentRole === 'customer'
                    ? currentCustomerUser?.username
                    : currentRole === 'sales'
                    ? currentSalesUser.name.split(' ')[0]
                    : currentAdminUser.name.split(' ')[0]}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {currentRole === 'customer'
                    ? `${currentCompany?.short_name} (${currentCompany?.country_alpha3})`
                    : currentRole === 'sales'
                    ? '业务员 (Sales)'
                    : '业务管理员 (Admin)'}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {isRoleDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  切换演示角色 (Role Switcher)
                </div>

                <div className="space-y-0.5 px-1.5">
                  <button
                    onClick={() => {
                      switchRole('customer', 'user-001a');
                      setIsRoleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between ${
                      currentRole === 'customer' && currentCustomerUser?.id === 'user-001a'
                        ? 'bg-slate-100 font-semibold text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">AK000123A (Apex 采购员 1)</div>
                      <div className="text-[10px] text-slate-500">
                        美商 Apex · Tier 3 金牌伙伴 (10% 折扣)
                      </div>
                    </div>
                    {currentRole === 'customer' && currentCustomerUser?.id === 'user-001a' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      switchRole('customer', 'user-001b');
                      setIsRoleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between ${
                      currentRole === 'customer' && currentCustomerUser?.id === 'user-001b'
                        ? 'bg-slate-100 font-semibold text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">AK000123B (Apex 采购员 2)</div>
                      <div className="text-[10px] text-slate-500">
                        同公司第 2 账号 · 验证共享等级与订单
                      </div>
                    </div>
                    {currentRole === 'customer' && currentCustomerUser?.id === 'user-001b' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      switchRole('customer', 'user-002a');
                      setIsRoleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between ${
                      currentRole === 'customer' && currentCustomerUser?.id === 'user-002a'
                        ? 'bg-slate-100 font-semibold text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">AK000456A (EuroBag 采购员)</div>
                      <div className="text-[10px] text-amber-600">
                        新账户 · 首次登录强制改密测试
                      </div>
                    </div>
                    {currentRole === 'customer' && currentCustomerUser?.id === 'user-002a' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  <button
                    onClick={() => {
                      switchRole('sales');
                      setIsRoleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between ${
                      currentRole === 'sales'
                        ? 'bg-slate-100 font-semibold text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-indigo-600" />
                      <div>
                        <div className="font-medium">业务员 (Tom Miller)</div>
                        <div className="text-[10px] text-slate-500">
                          订单确认/预占/延期 · 付款登记 · 物流发货
                        </div>
                      </div>
                    </div>
                    {currentRole === 'sales' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  </button>

                  <button
                    onClick={() => {
                      switchRole('admin');
                      setIsRoleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between ${
                      currentRole === 'admin'
                        ? 'bg-slate-100 font-semibold text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-amber-600" />
                      <div>
                        <div className="font-medium">业务管理员 (Admin Lin)</div>
                        <div className="text-[10px] text-slate-500">
                          公司建档 · AK账户生成 · 促销与等级配置
                        </div>
                      </div>
                    </div>
                    {currentRole === 'admin' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
