/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import {
  Store,
  ShoppingCart,
  Clock,
  Award,
  ClipboardList,
  Mail,
  Boxes,
  Users,
  Settings,
} from 'lucide-react';

export const BottomNav: React.FC = () => {
  const { currentRole, activeTab, setActiveTab, cart, unreadNotificationCount } = useApp();

  const totalCartItems = cart.reduce((acc, item) => acc + item.quantity, 0);

  if (currentRole === 'customer') {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 lg:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4 items-center h-16 max-w-lg mx-auto px-2" data-testid="customer-bottom-nav">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
              activeTab === 'catalog' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <Store className="w-5 h-5" />
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">Catalog</span>
          </button>

          <button
            onClick={() => setActiveTab('cart')}
            aria-label="Order list"
            data-testid="nav-order-list"
            className={`min-h-[44px] flex flex-col items-center justify-center relative transition-colors ${
              activeTab === 'cart' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <div className="relative">
              <ShoppingCart className="w-5 h-5" />
              {totalCartItems > 0 && (
                <span className="absolute -top-1.5 -right-2 px-1.5 py-0.2 bg-slate-900 text-white text-[9px] font-bold rounded-full">
                  {totalCartItems}
                </span>
              )}
            </div>
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">Order list</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
              activeTab === 'orders' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <Clock className="w-5 h-5" />
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">Orders</span>
          </button>

          <button
            onClick={() => setActiveTab('membership')}
            className={`min-h-[44px] flex flex-col items-center justify-center relative transition-colors ${
              activeTab === 'membership' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <div className="relative">
              <Award className="w-5 h-5" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500" />
              )}
            </div>
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">Membership</span>
          </button>
        </div>
      </nav>
    );
  }

  if (currentRole === 'sales') {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 lg:hidden">
        <div className="grid grid-cols-4 items-center h-16 max-w-lg mx-auto px-2">
          <button
            onClick={() => setActiveTab('sales_orders')}
            className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
              activeTab === 'sales_orders' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <ClipboardList className="w-5 h-5" />
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">订单处理</span>
          </button>

          <button
            onClick={() => setActiveTab('restock_manage')}
            className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
              activeTab === 'restock_manage' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <Boxes className="w-5 h-5" />
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">补货需求</span>
          </button>

          <button
            onClick={() => setActiveTab('internal_mailbox')}
            className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
              activeTab === 'internal_mailbox' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <Mail className="w-5 h-5" />
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">内部邮件</span>
          </button>

          <button
            onClick={() => setActiveTab('inventory_import')}
            className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
              activeTab === 'inventory_import' ? 'text-slate-900 font-semibold' : 'text-slate-500'
            }`}
          >
            <Boxes className="w-5 h-5" />
            <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">库存监控</span>
          </button>
        </div>
      </nav>
    );
  }

  // Admin
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 lg:hidden">
      <div className="grid grid-cols-4 items-center h-16 max-w-lg mx-auto px-2">
        <button
          onClick={() => setActiveTab('admin_companies')}
          className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
            activeTab === 'admin_companies' ? 'text-slate-900 font-semibold' : 'text-slate-500'
          }`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">客户建档</span>
        </button>

        <button
          onClick={() => setActiveTab('inventory_import')}
          className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
            activeTab === 'inventory_import' ? 'text-slate-900 font-semibold' : 'text-slate-500'
          }`}
        >
          <Boxes className="w-5 h-5" />
          <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">Excel导入</span>
        </button>

        <button
          onClick={() => setActiveTab('promo_tier')}
          className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
            activeTab === 'promo_tier' ? 'text-slate-900 font-semibold' : 'text-slate-500'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">促销等级</span>
        </button>

        <button
          onClick={() => setActiveTab('audit_logs')}
          className={`min-h-[44px] flex flex-col items-center justify-center transition-colors ${
            activeTab === 'audit_logs' ? 'text-slate-900 font-semibold' : 'text-slate-500'
          }`}
        >
          <ClipboardList className="w-5 h-5" />
          <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">审计日志</span>
        </button>
      </div>
    </nav>
  );
};
