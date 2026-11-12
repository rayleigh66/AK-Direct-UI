/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Menu,
  Search,
  Bell,
  Smartphone,
  Monitor,
  FileCheck,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

interface TopbarProps {
  onOpenMobileSidebar: () => void;
  onOpenTestMatrix: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  onOpenMobileSidebar,
  onOpenTestMatrix,
}) => {
  const {
    activeTab,
    currentRole,
    currentCustomerUser,
    isMobileSimulator,
    toggleMobileSimulator,
    setIsCommandSearchOpen,
    unreadNotificationCount,
    notifications,
    currentCompany,
    setActiveTab,
  } = useApp();

  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // Tab Title mapping
  const tabTitles: { [key: string]: string } = {
    catalog: '商城现货 (Catalog)',
    cart: '订购清单 (Order List)',
    orders: '我的订单 (My Orders)',
    membership: '会员等级 (Membership)',
    notifications: '站内通知 (Notifications)',
    sales_orders: '业务员订单处理',
    restock_manage: '客户补货需求',
    internal_mailbox: '业务员内部邮件中心',
    inventory_import: '多仓库存与 Excel 导入',
    admin_products: '商品目录管理',
    admin_companies: '客户与账户建档',
    promo_tier: '促销与等级配置',
    audit_logs: '敏感操作审计日志',
  };

  const customerTabTitles: { [key: string]: string } = {
    catalog: 'Catalog',
    cart: 'Order list',
    orders: 'My orders',
    membership: 'Membership',
    notifications: 'Notifications',
  };
  const currentTabName =
    currentRole === 'customer'
      ? customerTabTitles[activeTab] ?? 'Catalog'
      : tabTitles[activeTab] || '总览看板';
  const currentDate = new Date().toLocaleDateString(
    currentRole === 'customer' ? 'en-US' : 'zh-CN',
    {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    }
  );

  const companyNotifs = notifications.filter(n => n.company_id === currentCompany?.id);

  return (
    <header className="sticky top-0 z-30 h-[74px] bg-white border-b border-[#e8e8e6] px-5 sm:px-8 flex items-center justify-between gap-4">
      {/* Left: Hamburger (mobile) + Breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenMobileSidebar}
          className="lg:hidden w-[39px] h-[39px] border border-[#e8e8e6] rounded-[10px] bg-white flex items-center justify-center text-[#4f5150] hover:bg-[#f6f6f4] shrink-0"
          aria-label={currentRole === 'customer' ? 'Open navigation' : '菜单'}
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 text-xs text-[#aaa] whitespace-nowrap overflow-hidden">
          <span className="hidden sm:inline font-medium">AOKING Direct</span>
          <span className="hidden sm:inline text-[#c0c0c0]">/</span>
          <strong className="text-[#252525] font-bold text-xs truncate">
            {currentTabName}
          </strong>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Global Search Trigger (Command K) */}
        <button
          onClick={() => setIsCommandSearchOpen(true)}
          className="w-10 sm:w-[260px] h-10 bg-[#f8f8f7] border border-[#eeeeed] rounded-[10px] flex items-center justify-center sm:justify-start gap-2.5 px-0 sm:px-3 text-[#8c8d8c] hover:border-[#ccc] transition-colors shrink-0"
          title="Global search (⌘ K)"
          aria-label="Global search"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:block flex-1 text-left text-xs truncate">{currentRole === 'customer' ? 'Search products, orders...' : '搜索款号、订单、客户...'}</span>
          <span className="text-[10px] font-mono bg-white border border-[#ebebeb] rounded-[5px] px-1.5 py-0.5 text-[#9b9b9b] hidden sm:inline">
            ⌘ K
          </span>
        </button>

        {/* Date string */}
        <div className="hidden xl:block text-xs text-[#858585] whitespace-nowrap">
          {currentDate}
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-[1px] h-6 bg-[#e8e8e6]" />

        {/* Acceptance Test Matrix Button (internal QA only) */}
        {currentRole !== 'customer' && (
          <button
            onClick={onOpenTestMatrix}
            className="hidden lg:flex items-center gap-1.5 px-3 py-2 border border-[#e8e8e6] bg-white hover:bg-[#f8f8f6] rounded-[9px] text-xs font-bold text-[#343434] transition-all hover:-translate-y-0.5 shadow-2xs"
            title="打开核心验收矩阵"
          >
            <FileCheck className="w-3.5 h-3.5 text-[#ff681e]" />
            <span className="hidden md:inline">验收矩阵</span>
            <span className="text-[10px] font-mono bg-[#fff1e8] text-[#ff681e] px-1 rounded font-bold">
              T01-T35
            </span>
          </button>
        )}

        {/* Mobile viewport simulator is an internal QA control, not customer UI. */}
        {currentRole !== 'customer' && (
          <button
            onClick={toggleMobileSimulator}
            className="w-[39px] h-[39px] border border-[#e8e8e6] rounded-[10px] bg-white flex items-center justify-center text-[#4f5150] hover:bg-[#f6f6f4] transition-colors"
            title="切换手机视口模拟"
          >
            {isMobileSimulator ? (
              <Monitor className="w-4 h-4 text-[#ff681e]" />
            ) : (
              <Smartphone className="w-4 h-4 text-[#858789]" />
            )}
          </button>
        )}

        {/* Notification Bell — customer-only to avoid leaking customer data into internal roles.
            Internal roles keep a same-size spacer so the topbar layout does not shift. */}
        {currentRole === 'customer' ? (
        <div className="relative">
          <button
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            className="w-[39px] h-[39px] border border-[#e8e8e6] rounded-[10px] bg-white flex items-center justify-center text-[#4f5150] hover:bg-[#f6f6f4] relative transition-colors"
            title={currentRole === 'customer' ? 'Notifications' : '通知中心'}
            aria-label={currentRole === 'customer' ? 'Notifications' : '通知中心'}
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationCount > 0 && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#ff681e] ring-2 ring-white" />
            )}
          </button>

          {/* Notification Flyout */}
          {isNotifOpen && (
            <div className="absolute right-0 mt-2 w-[340px] bg-white rounded-[14px] border border-[#e8e8e6] shadow-[0_12px_45px_rgba(0,0,0,0.12)] p-4 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between pb-3 border-b border-[#f0f0ef]">
                <h3 className="text-sm font-bold text-[#151515]">{currentRole === 'customer' ? 'Notifications' : '消息中心'}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#fff1e8] text-[#ff681e]">
                  {currentRole === 'customer' ? `${unreadNotificationCount} unread` : `${unreadNotificationCount} 条未读`}
                </span>
              </div>

              <div className="divide-y divide-[#f0f0ef] max-h-[320px] overflow-y-auto">
                {companyNotifs.slice(0, 4).map(n => (
                  <div key={n.id} className="py-3 text-xs space-y-1">
                    <div className="font-bold text-[#151515] flex items-center justify-between">
                      <span>{n.title}</span>
                      <span className="text-[10px] text-[#aaa] font-mono">{n.created_at.slice(11, 16)}</span>
                    </div>
                    <div className="text-[11px] text-[#8c8e8e] leading-relaxed">{n.message}</div>
                  </div>
                ))}

                {companyNotifs.length === 0 && (
                  <div className="py-6 text-center text-xs text-[#aaa]">{currentRole === 'customer' ? 'No unread notifications' : '暂无未读消息'}</div>
                )}
              </div>

              <div className="pt-2 border-t border-[#f0f0ef]">
                <button
                  onClick={() => {
                    setIsNotifOpen(false);
                    setActiveTab('notifications');
                  }}
                  className="w-full py-1.5 text-center text-xs font-bold text-[#ff681e] hover:text-[#dd4a00] flex items-center justify-center gap-1"
                >
                  <span>{currentRole === 'customer' ? 'View all notifications' : '查看全部通知记录'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
        ) : (
          <div className="w-[39px] h-[39px] shrink-0" aria-hidden="true" />
        )}

        {/* Top Avatar badge */}
        <div className="w-9 h-9 bg-[#171717] text-white flex items-center justify-center rounded-[10px] font-black text-xs font-mono shadow-xs">
          {currentRole === 'customer' ? 'AK' : currentRole === 'sales' ? 'SA' : 'AD'}
        </div>
      </div>
    </header>
  );
};
