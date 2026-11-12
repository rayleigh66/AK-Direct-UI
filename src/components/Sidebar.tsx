/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Store,
  ShoppingCart,
  Package,
  Clock,
  Award,
  ClipboardList,
  Boxes,
  Mail,
  Users,
  Settings,
  Layers,
  ShieldCheck,
  ChevronRight,
  UserCheck,
  Building2,
  CheckCircle2,
} from 'lucide-react';
import { BrandLockup } from './BrandLockup';

interface SidebarProps {
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, onCloseMobile }) => {
  const {
    currentRole,
    activeTab,
    setActiveTab,
    cart,
    currentCustomerUser,
    currentCompany,
    currentSalesUser,
    currentAdminUser,
    switchRole,
  } = useApp();

  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const customer = currentRole === 'customer';
  const navGroups = customer
    ? [
        {
          label: 'SOURCING · CUSTOMER',
          links: [
            { id: 'catalog', label: 'Catalog', icon: Store },
            {
              id: 'cart',
              label: 'Order list',
              icon: ShoppingCart,
              count: totalCartCount > 0 ? totalCartCount : null,
            },
            { id: 'orders', label: 'My orders', icon: Clock },
            { id: 'membership', label: 'Membership', icon: Award },
          ],
        },
      ]
    : currentRole === 'sales'
      ? [
          {
            label: '履约协同 · 业务员',
            links: [
              { id: 'sales_orders', label: '订单核准与锁库', icon: ClipboardList },
              { id: 'restock_manage', label: '客户补货需求', icon: Boxes },
              { id: 'internal_mailbox', label: '业务员内部邮件', icon: Mail },
            ],
          },
        ]
      : [
          {
            label: '运营配置 · 管理员',
            links: [
              { id: 'admin_products', label: '商品目录管理', icon: Package },
              { id: 'admin_companies', label: '客户与账户建档', icon: Users },
              { id: 'inventory_import', label: '多仓库存与导入', icon: Layers },
              { id: 'promo_tier', label: '促销与等级配置', icon: Settings },
              { id: 'audit_logs', label: '敏感操作审计日志', icon: ShieldCheck },
            ],
          },
        ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:sticky top-0 left-0 bottom-0 z-50 w-[248px] bg-white border-r border-[#e8e8e6] flex flex-col h-screen transition-transform duration-200 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="h-[76px] px-6 flex items-center border-b border-[#e8e8e6] shrink-0">
          <BrandLockup size="sm" testId="brand-lockup-sidebar" />
        </div>

        {/* Scrollable Navigation */}
        <div className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
          {navGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              <div className="px-3 text-[10px] font-bold tracking-[1.7px] text-[#a3a4a4] uppercase mb-2">
                {group.label}
              </div>
              {group.links.map(link => {
                const Icon = link.icon;
                const isActive = activeTab === link.id;
                return (
                  <button
                    key={link.id}
                    onClick={() => {
                      setActiveTab(link.id);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-xs font-semibold text-left transition-all ${
                      isActive
                        ? 'bg-[#171717] text-white shadow-xs'
                        : 'text-[#696b6c] hover:bg-[#f6f6f5] hover:text-[#1f1f1f]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#ff843f]' : ''}`} />
                    <span className="truncate">{link.label}</span>
                    {link.count !== null && link.count !== undefined && (
                      <span
                        className={`ml-auto text-[10px] font-extrabold px-1.5 py-0.5 rounded-[5px] ${
                          isActive ? 'bg-[#343434] text-white' : 'bg-[#f3f3f2] text-[#666]'
                        }`}
                      >
                        {link.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sidebar Bottom Note & Profile */}
        <div className="p-3 border-t border-[#e8e8e6] shrink-0 space-y-3 bg-[#fafaf9] pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {/* Status Note with Pulse */}
          <div className="bg-white border border-[#eeeee9] p-3 rounded-[11px] flex items-start gap-2.5 shadow-2xs">
            <span className="relative flex h-2 w-2 mt-1 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3bb78c] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3bb78c] shadow-[0_0_0_3px_#def6eb]" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[#151515] leading-tight">
                {customer ? 'Spot ordering · rules active' : '现货订购 · 业务规则运行中'}
              </div>
              <div className="text-[9px] text-[#aaa] font-mono mt-0.5 tracking-wide">
                PRD V0.3 COMPLIANT / DEMO
              </div>
            </div>
          </div>

          {/* User Profile Bar with Fast Switcher */}
          <div className="relative">
            <button
              onClick={() => setIsRoleMenuOpen(!isRoleMenuOpen)}
              className="w-full flex items-center gap-2.5 p-2 rounded-[10px] hover:bg-white text-left transition-colors border border-transparent hover:border-[#e8e8e6]"
            >
              <div className="w-8 h-8 rounded-full bg-[#e9ebeb] border border-[#dce0e0] flex items-center justify-center font-bold text-xs text-[#474747] shrink-0 font-mono">
                {currentRole === 'customer' ? 'CU' : currentRole === 'sales' ? 'SA' : 'AD'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-[#151515] truncate">
                  {currentRole === 'customer'
                    ? currentCustomerUser?.username
                    : currentRole === 'sales'
                    ? currentSalesUser.name
                    : currentAdminUser.name}
                </div>
                <div className="text-[10px] text-[#a1a1a1] truncate">
                  {currentRole === 'customer'
                    ? `${currentCompany?.short_name} (${currentCompany?.country_alpha3})`
                    : currentRole === 'sales'
                    ? '销售运营中心'
                    : '业务管理中心'}
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#aaa] shrink-0" />
            </button>

            {/* Quick Switch Dropdown */}
            {isRoleMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-xl border border-[#e8e8e6] p-2 z-50 text-xs space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold text-[#999] uppercase tracking-wider">
                  {customer ? 'Switch demo role' : '切换用户角色'}
                </div>
                <button
                  onClick={() => {
                    switchRole('customer', 'user-001a');
                    setIsRoleMenuOpen(false);
                    onCloseMobile();
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[#f6f6f5] flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-[#151515]">AK000123A (Apex buyer 1)</div>
                    <div className="text-[10px] text-[#888]">Tier 3 Gold Partner · 10% off</div>
                  </div>
                  {currentRole === 'customer' && currentCustomerUser?.id === 'user-001a' && (
                    <CheckCircle2 className="w-4 h-4 text-[#ff681e]" />
                  )}
                </button>

                <button
                  onClick={() => {
                    switchRole('customer', 'user-001b');
                    setIsRoleMenuOpen(false);
                    onCloseMobile();
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[#f6f6f5] flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-[#151515]">AK000123B (Apex buyer 2)</div>
                    <div className="text-[10px] text-[#888]">Shares company tier and orders</div>
                  </div>
                  {currentRole === 'customer' && currentCustomerUser?.id === 'user-001b' && (
                    <CheckCircle2 className="w-4 h-4 text-[#ff681e]" />
                  )}
                </button>

                <button
                  onClick={() => {
                    switchRole('sales');
                    setIsRoleMenuOpen(false);
                    onCloseMobile();
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[#f6f6f5] flex items-center justify-between"
                >
                  <div className="flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-[#ff681e]" />
                    <span className="font-semibold text-[#151515]">{customer ? 'Sales (Tom Miller)' : '业务员 (Tom Miller)'}</span>
                  </div>
                  {currentRole === 'sales' && <CheckCircle2 className="w-4 h-4 text-[#ff681e]" />}
                </button>

                <button
                  onClick={() => {
                    switchRole('admin');
                    setIsRoleMenuOpen(false);
                    onCloseMobile();
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[#f6f6f5] flex items-center justify-between"
                >
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[#aa750e]" />
                    <span className="font-semibold text-[#151515]">{customer ? 'Administrator (Admin Lin)' : '业务管理员 (Admin Lin)'}</span>
                  </div>
                  {currentRole === 'admin' && <CheckCircle2 className="w-4 h-4 text-[#ff681e]" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
