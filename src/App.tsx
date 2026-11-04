/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { canAccessTab, defaultTabForRole } from './utils/roles';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { BottomNav } from './components/BottomNav';
import { PasswordResetModal } from './components/PasswordResetModal';
import { TestMatrixModal } from './components/TestMatrixModal';
import { DetailDrawer } from './components/DetailDrawer';
import { CommandPalette } from './components/CommandPalette';
import { ToastStack } from './components/ToastStack';
import { RealAuthGate } from './auth/RealAuthGate';

// Customer Views
import { CatalogView } from './components/CustomerViews/CatalogView';
import { OrderListView } from './components/CustomerViews/OrderListView';
import { MyOrdersView } from './components/CustomerViews/MyOrdersView';
import { MembershipView } from './components/CustomerViews/MembershipView';
import { NotificationsView } from './components/CustomerViews/NotificationsView';

// Internal Views
import { SalesOrdersView } from './components/InternalViews/SalesOrdersView';
import { RestockManageView } from './components/InternalViews/RestockManageView';
import { InternalMailboxView } from './components/InternalViews/InternalMailboxView';
import { InventoryImportView } from './components/InternalViews/InventoryImportView';
import { CompanyAccountsView } from './components/InternalViews/CompanyAccountsView';
const ProductAdminView = lazy(() =>
  import('./components/InternalViews/ProductAdminView').then(module => ({
    default: module.ProductAdminView,
  }))
);
import { PromoTierConfigView } from './components/InternalViews/PromoTierConfigView';
import { AuditLogView } from './components/InternalViews/AuditLogView';

import { Smartphone } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { activeTab, currentRole, setActiveTab, isMobileSimulator, toggleMobileSimulator } = useApp();
  const customer = currentRole === 'customer';
  const [isTestMatrixOpen, setIsTestMatrixOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const resolvedTab = canAccessTab(currentRole, activeTab)
    ? activeTab
    : defaultTabForRole(currentRole);

  useEffect(() => {
    if (activeTab !== resolvedTab) {
      setActiveTab(resolvedTab);
    }
  }, [activeTab, resolvedTab, setActiveTab]);

  const renderActiveView = () => {
    switch (resolvedTab) {
      // Customer Views
      case 'catalog':
        return <CatalogView />;
      case 'cart':
        return <OrderListView />;
      case 'orders':
        return <MyOrdersView />;
      case 'membership':
        return <MembershipView />;
      case 'notifications':
        return <NotificationsView />;

      // Sales Views
      case 'sales_orders':
        return <SalesOrdersView />;
      case 'restock_manage':
        return <RestockManageView />;
      case 'internal_mailbox':
        return <InternalMailboxView />;

      // Internal / Admin Views
      case 'inventory_import':
        return <InventoryImportView />;
      case 'admin_products':
        return (
          <Suspense
            fallback={
              <div className="p-8 text-center text-xs text-slate-500">正在加载商品管理…</div>
            }
          >
            <ProductAdminView />
          </Suspense>
        );
      case 'admin_companies':
        return <CompanyAccountsView />;
      case 'promo_tier':
        return <PromoTierConfigView />;
      case 'audit_logs':
        return <AuditLogView />;

      default:
        return <CatalogView />;
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f8f6] text-[#151515] flex flex-col selection:bg-[#ffb892] selection:text-[#111]">
      {/* Compliance Notice Banner on Top */}
      <div className="bg-[#171717] text-white px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border-b border-white/10 z-50">
        <div className="flex items-center gap-2 text-[11px] sm:text-xs">
          <span className="w-2 h-2 rounded-full bg-[#ff681e] animate-pulse" />
          <strong className="text-[#ff843f]">AOKING Direct v0.3</strong>
          <span className="text-[#666]">·</span>
          <span className="text-slate-300">
            {customer
              ? 'Privacy-first wholesale ordering · human-reviewed requests'
              : '高标准工业协同设计 · 严格隐私保护（不收集客户电话、邮箱与地址）· 现货订购人工审核流程'}
          </span>
        </div>
        {!customer && (
          <div className="flex items-center gap-2 text-[11px] ml-auto">
            <button
              onClick={() => setIsTestMatrixOpen(true)}
              className="text-[#ff843f] hover:underline font-bold"
            >
              打开验收矩阵 (T01-T35)
            </button>
          </div>
        )}
      </div>

      {isMobileSimulator ? (
        /* Mobile Simulator Canvas (390 x 844 iPhone Canvas) */
        <div className="py-8 px-4 flex flex-col items-center justify-center flex-1 bg-[#eaeae7]">
          <div className="mb-3 flex items-center gap-2 text-xs text-[#666]">
            <Smartphone className="w-4 h-4 text-[#ff681e]" />
            <span className="font-bold text-[#151515]">
              移动端真机触控视口模拟 (390 x 844)
            </span>
            <button
              onClick={toggleMobileSimulator}
              className="ml-2 text-[#ff681e] font-semibold hover:underline"
            >
              切回自适应宽屏
            </button>
          </div>

          {/* Smartphone Frame */}
          <div className="relative w-[390px] h-[844px] bg-[#f8f8f6] rounded-[48px] shadow-2xl border-[10px] border-[#171717] overflow-hidden flex flex-col">
            {/* Speaker / Notch Bar */}
            <div className="h-6 bg-[#171717] w-full flex items-center justify-center shrink-0">
              <div className="w-24 h-4 bg-black rounded-b-xl" />
            </div>

            {/* Inner Topbar in phone */}
            <Topbar
              onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
              onOpenTestMatrix={() => setIsTestMatrixOpen(true)}
            />

            {/* Inner Mobile Scroll Area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 pb-20">
              {renderActiveView()}
            </div>

            {/* Bottom Nav */}
            <div className="shrink-0 bg-white border-t border-[#e8e8e6]">
              <BottomNav />
            </div>
          </div>
        </div>
      ) : (
        /* Standard FactoryOS Layout: 248px Left Sidebar + Right Workspace */
        <div className="flex flex-1 min-w-0">
          {/* Left Sidebar */}
          <Sidebar
            isMobileOpen={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
          />

          {/* Right Workspace */}
          <div className="flex-1 min-w-0 flex flex-col">
            <Topbar
              onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
              onOpenTestMatrix={() => setIsTestMatrixOpen(true)}
            />

            <main className="flex-1 p-6 sm:p-10 max-w-[1660px] w-full mx-auto">
              {renderActiveView()}
            </main>

            {/* Quiet Footer Note matching FactoryOS */}
            <footer className="text-center py-8 text-[#b0b0ae] text-[10px] tracking-wide border-t border-[#e8e8e6] bg-white">
              AOKING DIRECT · SPOT WHOLESALE OPERATIONS SYSTEM 2026 &nbsp; / &nbsp; {customer ? 'Demo data · privacy protected' : '演示数据已预载 · 严格保护客户隐私'}
            </footer>
          </div>
        </div>
      )}

      {/* Global Bottom Navigation on real mobile devices (when not in simulator) */}
      {!isMobileSimulator && <BottomNav />}

      {/* Global Detail Drawer (Right slide-over) */}
      <DetailDrawer />

      {/* Global Command Palette (⌘ K) */}
      <CommandPalette />

      {/* FactoryOS Toast Stack */}
      <ToastStack />

      {/* Password Reset Modal for first-time login enforcement (T31) */}
      <PasswordResetModal />

      {/* Test Matrix Modal (T01 - T35) */}
      {isTestMatrixOpen && (
        <TestMatrixModal onClose={() => setIsTestMatrixOpen(false)} />
      )}
    </div>
  );
};

const REAL_AUTH_ENABLED = import.meta.env.VITE_REAL_AUTH === 'true';

export default function App() {
  if (REAL_AUTH_ENABLED) {
    return <RealAuthGate />;
  }
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
