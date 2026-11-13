import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  ClipboardList,
  LogOut,
  Package,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';
import type { AuthUserDto } from '../auth/api';
import { CustomerCatalogView } from './views/CustomerCatalogView';
import { AdminCatalogView } from './views/AdminCatalogView';
import { AdminCustomersView } from './views/AdminCustomersView';
import { InventoryView } from './views/InventoryView';
import { ImportView } from './views/ImportView';
import { SetupView } from './views/SetupView';
import { CartView } from './views/CartView';
import { OrdersView } from './views/OrdersView';
import { ApprovalsView } from './views/ApprovalsView';
import { TierPreviewView } from './views/TierPreviewView';
import { RealCartProvider, useRealCart } from './cart';
import { RealSidebar, type RealSidebarGroup } from './RealSidebar';
import { RealTopbar } from './RealTopbar';
import { BrandLockup } from '../components/BrandLockup';
import { formatCartBadge } from '../utils/cartCount';
import {
  InternalLanguageProvider,
  translateInternalText,
  useInternalLanguage,
} from './internalLanguage';

type TabKey =
  | 'catalog'
  | 'cart'
  | 'orders'
  | 'products'
  | 'inventory'
  | 'import'
  | 'setup'
  | 'tiers'
  | 'customers'
  | 'approvals';

const TAB_LABELS: Record<TabKey, { en: string; zh: string; icon: React.ReactNode }> = {
  catalog: { en: 'Catalogue', zh: '商品目录', icon: <Package className="w-4 h-4" /> },
  cart: { en: 'Cart', zh: '购物车', icon: <ShoppingCart className="w-4 h-4" /> },
  orders: { en: 'Orders', zh: '订单', icon: <ClipboardList className="w-4 h-4" /> },
  products: { en: 'Products', zh: '商品', icon: <Package className="w-4 h-4" /> },
  inventory: { en: 'Inventory', zh: '库存', icon: <Boxes className="w-4 h-4" /> },
  import: { en: 'Import', zh: '导入', icon: <Upload className="w-4 h-4" /> },
  setup: { en: 'Setup', zh: '基础设置', icon: <Settings2 className="w-4 h-4" /> },
  tiers: { en: 'Customer tiers', zh: '客户等级与折扣', icon: <Sparkles className="w-4 h-4" /> },
  customers: { en: 'Customers', zh: '客户管理', icon: <Users className="w-4 h-4" /> },
  approvals: { en: 'Approvals', zh: '审批', icon: <ShieldCheck className="w-4 h-4" /> },
};

const CartBadge: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const { cart } = useRealCart();
  const count = cart?.totalQuantity ?? 0;
  const badge = formatCartBadge(count);
  if (!cart) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="cart-badge"
      aria-label={`Cart, ${count} PCS`}
      className="fo-btn flex min-h-[42px] items-center gap-2 border-[var(--line)] bg-white text-[var(--ink)]"
    >
      <span className="relative">
        <ShoppingCart className="w-4 h-4" />
        {count > 0 && (
          <span
            data-testid="cart-badge-count"
            className="absolute -right-2 -top-2 grid h-4 min-w-[16px] place-items-center rounded-full bg-[var(--orange)] px-1 text-[9px] font-bold text-[var(--ink)]"
          >
            {badge}
          </span>
        )}
      </span>
      <span className="hidden sm:inline">Cart</span>
    </button>
  );
};

const INTERNAL_GROUPS: Array<{
  label: { en: string; zh: string };
  keys: TabKey[];
}> = [
  { label: { en: 'Catalogue', zh: '商品目录' }, keys: ['products'] },
  { label: { en: 'Operations', zh: '运营' }, keys: ['inventory', 'import', 'setup'] },
  { label: { en: 'Customers', zh: '客户' }, keys: ['customers'] },
  { label: { en: 'Orders', zh: '订单' }, keys: ['orders', 'approvals'] },
  { label: { en: 'Pricing', zh: '客户等级' }, keys: ['tiers'] },
];

const CustomerWorkspaceShell: React.FC<{
  user: AuthUserDto;
  onSignOut: () => void | Promise<void>;
  tabs: TabKey[];
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  renderTab: () => React.ReactNode;
}> = ({ user, onSignOut, tabs, activeTab, setActiveTab, renderTab }) => (
  <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--ink)]">
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1660px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLockup testId="brand-lockup" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CartBadge onOpen={() => setActiveTab('cart')} />
          <div
            data-testid="real-user-meta"
            className="max-w-[180px] text-right text-[11px] leading-tight sm:max-w-none"
          >
            <div className="truncate font-semibold">{user.displayName}</div>
            <div className="truncate font-mono text-[var(--muted)]">{user.username}</div>
          </div>
          <button
            type="button"
            onClick={() => void onSignOut()}
            aria-label="Sign out"
            className="fo-btn flex min-h-[42px] items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
      {tabs.length > 1 && (
        <nav
          className="mx-auto flex w-full max-w-[1660px] gap-1 overflow-x-auto px-3 pb-2 sm:px-6 lg:px-10"
          aria-label="Customer sections"
        >
          {tabs.map(tab => {
            const label = TAB_LABELS[tab];
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-current={active ? 'page' : undefined}
                data-testid={`real-tab-${tab}`}
                className={`flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-[var(--nav-active-bg)] text-white'
                    : 'text-[var(--muted)] hover:bg-[var(--subtle-bg)] hover:text-[var(--ink)]'
                }`}
              >
                <span className={active ? 'text-[var(--orange)]' : ''}>{label.icon}</span>
                {label.en}
              </button>
            );
          })}
        </nav>
      )}
    </header>

    <main className="mx-auto w-full max-w-[1660px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
      {renderTab()}
    </main>
  </div>
);

const InternalWorkspaceShell: React.FC<{
  user: AuthUserDto;
  onSignOut: () => void | Promise<void>;
  tabs: TabKey[];
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  renderTab: () => React.ReactNode;
}> = ({ user, onSignOut, tabs, activeTab, setActiveTab, renderTab }) => {
  const { language, setLanguage } = useInternalLanguage();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!navigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavigationOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const sidebar = document.getElementById('real-sidebar');
      const focusable = Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
  }, [navigationOpen]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (media.matches) setNavigationOpen(false);
    };
    closeOnDesktop();
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, []);

  const groups = useMemo<RealSidebarGroup[]>(() => {
    const grouped = INTERNAL_GROUPS.map(group => ({
      label: language === 'zh' ? group.label.zh : group.label.en,
      items: group.keys
        .filter(key => tabs.includes(key))
        .map(key => ({
          key,
          label: language === 'zh' ? TAB_LABELS[key].zh : TAB_LABELS[key].en,
          icon: TAB_LABELS[key].icon,
        })),
    })).filter(group => group.items.length > 0);
    const groupedKeys = new Set(INTERNAL_GROUPS.flatMap(group => group.keys));
    const leftovers = tabs.filter(key => !groupedKeys.has(key));
    if (leftovers.length) {
      grouped.push({
        label: language === 'zh' ? '其他' : 'Workspace',
        items: leftovers.map(key => ({
          key,
          label: language === 'zh' ? TAB_LABELS[key].zh : TAB_LABELS[key].en,
          icon: TAB_LABELS[key].icon,
        })),
      });
    }
    return grouped;
  }, [language, tabs]);

  const activeLabel = TAB_LABELS[activeTab];

  return (
    <div
      data-testid="internal-shell"
      className="min-h-screen bg-[var(--bg)] text-[var(--ink)]"
    >
      <RealSidebar
        groups={groups}
        activeKey={activeTab}
        open={navigationOpen}
        language={language}
        onSelect={key => {
          setActiveTab(key as TabKey);
          setNavigationOpen(false);
        }}
        onClose={() => setNavigationOpen(false)}
      />
      <div className="flex min-h-screen flex-col lg:pl-[248px]">
        <RealTopbar
          user={user}
          title={language === 'zh' ? activeLabel.zh : activeLabel.en}
          language={language}
          onLanguageChange={setLanguage}
          onSignOut={onSignOut}
          onOpenNavigation={() => setNavigationOpen(true)}
          navigationOpen={navigationOpen}
          menuButtonRef={menuButtonRef}
        />
        <main className="mx-auto w-full min-w-0 max-w-[1660px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
          {renderTab()}
        </main>
      </div>
    </div>
  );
};

const WorkspaceShell: React.FC<{
  user: AuthUserDto;
  onSignOut: () => void | Promise<void>;
}> = ({ user, onSignOut }) => {
  const isCustomer = user.type === 'customer';
  const can = (permission: string) => user.permissions.includes(permission);
  const canApprove =
    can('orders.approve_price') ||
    can('orders.approve_extension') ||
    can('orders.approve_release') ||
    can('orders.manage_confirmers');
  const tabs = useMemo<TabKey[]>(() => {
    if (isCustomer) return ['catalog', 'cart', 'orders'];
    const result: TabKey[] = [];
    if (can('catalog.manage')) {
      result.push('products', 'inventory', 'import', 'setup', 'tiers');
    } else if (can('inventory.read') || can('inventory.manage')) {
      result.push('inventory');
    }
    if (can('companies.manage')) result.push('customers');
    if (can('sales.read_all') || can('sales.read_assigned')) {
      // Sales land on Orders; administrators keep their catalogue workspace
      // first and see Orders after the configuration tabs.
      if (can('catalog.manage')) result.push('orders');
      else result.unshift('orders');
    }
    if (canApprove) {
      // The approval queue and confirmer management use their own explicit
      // permissions. A business administrator does not need sales.read_all.
      result.push('approvals');
    }
    return result.length ? result : ['inventory'];
  }, [isCustomer, user.permissions, canApprove]);

  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]);

  const renderTab = () => (
    <>
      {activeTab === 'catalog' && <CustomerCatalogView />}
      {activeTab === 'cart' && isCustomer && (
        <CartView
          user={user}
          onBrowse={() => setActiveTab('catalog')}
          onViewOrders={() => setActiveTab('orders')}
        />
      )}
      {activeTab === 'orders' && (
        <OrdersView scope={isCustomer ? 'customer' : can('sales.read_all') ? 'admin' : 'sales'} />
      )}
      {activeTab === 'approvals' && (
        <ApprovalsView
          canApprovePrice={can('orders.approve_price')}
          canApproveExtension={can('orders.approve_extension')}
          canApproveRelease={can('orders.approve_release')}
          canManageConfirmers={can('orders.manage_confirmers')}
        />
      )}
      {activeTab === 'products' && <AdminCatalogView canWrite={can('catalog.manage')} />}
      {activeTab === 'inventory' && (
        <InventoryView
          canManage={can('inventory.manage')}
          canRead={can('inventory.read')}
          internal={!isCustomer}
        />
      )}
      {activeTab === 'import' && <ImportView />}
      {activeTab === 'setup' && <SetupView />}
      {activeTab === 'tiers' && <TierPreviewView />}
      {activeTab === 'customers' && (
        <AdminCustomersView
          canManageCompanies={can('companies.manage')}
          canManageAccounts={can('accounts.manage')}
          canManageBrands={can('brands.manage')}
          canReadCatalog={can('catalog.read') || can('catalog.manage')}
        />
      )}
    </>
  );

  if (isCustomer) {
    return (
      <CustomerWorkspaceShell
        user={user}
        onSignOut={onSignOut}
        tabs={tabs}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        renderTab={renderTab}
      />
    );
  }

  return (
    <InternalWorkspaceShell
      user={user}
      onSignOut={onSignOut}
      tabs={tabs}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      renderTab={renderTab}
    />
  );
};

export const RealWorkspace: React.FC<{
  user: AuthUserDto;
  onSignOut: () => void | Promise<void>;
}> = ({ user, onSignOut }) => (
  <RealCartProvider user={user}>
    <InternalLanguageProvider userKey={user.username}>
      <WorkspaceShell user={user} onSignOut={onSignOut} />
    </InternalLanguageProvider>
  </RealCartProvider>
);

export const LoadingBlock: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => {
  const { language } = useInternalLanguage();
  return (
    <div className="flex items-center gap-2 py-10 text-xs text-[var(--muted)] justify-center">
      <RefreshCw className="w-4 h-4 animate-spin" />
      {translateInternalText(label, language)}
    </div>
  );
};

export const ErrorBlock: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => {
  const { t, language } = useInternalLanguage();
  const needsChineseSummary = language === 'zh' && !/[\u3400-\u9fff]/.test(message);
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
    >
      {needsChineseSummary ? (
        <div className="min-w-0 flex-1">
          <div>{t('The operation failed. Please retry or contact an administrator.', '操作失败，请重试或联系管理员。')}</div>
          <details className="mt-1 text-[10px]">
            <summary className="cursor-pointer font-semibold">{t('Technical detail', '技术详情')}</summary>
            <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{message}</pre>
          </details>
        </div>
      ) : (
        <span className="flex-1">{message}</span>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white"
        >
          {t('Retry', '重试')}
        </button>
      )}
    </div>
  );
};
