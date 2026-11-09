import React, { useMemo, useState } from 'react';
import {
  Boxes,
  ClipboardList,
  LogOut,
  Package,
  RefreshCw,
  Settings2,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { AuthUserDto } from '../auth/api';
import { CustomerCatalogView } from './views/CustomerCatalogView';
import { AdminCatalogView } from './views/AdminCatalogView';
import { InventoryView } from './views/InventoryView';
import { ImportView } from './views/ImportView';
import { SetupView } from './views/SetupView';
import { CartView } from './views/CartView';
import { OrdersView } from './views/OrdersView';
import { TierPreviewView } from './views/TierPreviewView';
import { RealCartProvider, useRealCart } from './cart';
import { LanguageToggle } from '../components/ui/LanguageToggle';
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
  | 'tiers';

const TAB_LABELS: Record<TabKey, { en: string; zh: string; icon: React.ReactNode }> = {
  catalog: { en: 'Catalogue', zh: '商品目录', icon: <Package className="w-4 h-4" /> },
  cart: { en: 'Cart', zh: '购物车', icon: <ShoppingCart className="w-4 h-4" /> },
  orders: { en: 'Orders', zh: '订单', icon: <ClipboardList className="w-4 h-4" /> },
  products: { en: 'Products', zh: '商品', icon: <Package className="w-4 h-4" /> },
  inventory: { en: 'Inventory', zh: '库存', icon: <Boxes className="w-4 h-4" /> },
  import: { en: 'Import', zh: '导入', icon: <Upload className="w-4 h-4" /> },
  setup: { en: 'Setup', zh: '基础设置', icon: <Settings2 className="w-4 h-4" /> },
  tiers: { en: 'Customer tiers', zh: '客户等级与折扣', icon: <Sparkles className="w-4 h-4" /> },
};

const CartBadge: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const { cart } = useRealCart();
  const count = cart?.totalQuantity ?? 0;
  if (!cart) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="cart-badge"
      className="fo-btn flex min-h-[42px] items-center gap-2 border-[var(--line)] bg-white text-[var(--ink)]"
    >
      <span className="relative">
        <ShoppingCart className="w-4 h-4" />
        {cart.itemCount > 0 && (
          <span className="absolute -right-2 -top-2 grid h-4 min-w-[16px] place-items-center rounded-full bg-[var(--orange)] px-1 text-[9px] font-bold text-[var(--ink)]">
            {cart.itemCount}
          </span>
        )}
      </span>
      <span>{count} PCS</span>
    </button>
  );
};

const WorkspaceShell: React.FC<{
  user: AuthUserDto;
  onSignOut: () => void | Promise<void>;
}> = ({ user, onSignOut }) => {
  const isCustomer = user.type === 'customer';
  const { language, setLanguage } = useInternalLanguage();
  const can = (permission: string) => user.permissions.includes(permission);
  const tabs = useMemo<TabKey[]>(() => {
    if (isCustomer) return ['catalog', 'cart', 'orders'];
    const result: TabKey[] = [];
    if (can('catalog.manage')) {
      result.push('products', 'inventory', 'import', 'setup', 'tiers');
    } else if (can('inventory.read') || can('inventory.manage')) {
      result.push('inventory');
    }
    if (can('sales.read_all') || can('sales.read_assigned')) {
      // Sales land on Orders; administrators keep their catalogue workspace
      // first and see Orders after the configuration tabs.
      if (can('catalog.manage')) result.push('orders');
      else result.unshift('orders');
    }
    return result.length ? result : ['inventory'];
  }, [isCustomer, user.permissions]);

  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--ink)]">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1660px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--ink)]">
              <span className="h-[17px] w-[17px] rotate-45 rounded-[3px] border-2 border-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-extrabold uppercase tracking-[2px] text-[var(--orange-deep)]">
                {isCustomer
                  ? 'AOKING Direct · Wholesale operations'
                  : language === 'zh'
                    ? 'AOKING Direct · 批发运营'
                    : 'AOKING Direct · Wholesale operations'}
              </div>
              <div className="truncate text-sm font-extrabold tracking-[-0.4px] sm:text-base">
                {isCustomer ? 'Wholesale ordering' : language === 'zh' ? '运营工作台' : 'Operations workspace'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCustomer && <CartBadge onOpen={() => setActiveTab('cart')} />}
            {!isCustomer && (
              <LanguageToggle
                value={language}
                onChange={setLanguage}
                label={language === 'zh' ? '内部界面语言' : 'Internal language'}
                testId="internal-language-toggle"
              />
            )}
            <div className="max-w-[180px] text-right text-[11px] leading-tight sm:max-w-none">
              <div className="truncate font-semibold">{user.displayName}</div>
              {isCustomer ? (
                <div className="truncate text-[var(--muted)]">
                  {user.companyName} ({user.companyCode})
                </div>
              ) : (
                <div className="truncate font-mono text-[var(--muted)]">{user.username}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              aria-label={isCustomer ? 'Sign out' : language === 'zh' ? '退出登录' : 'Sign out'}
              className="fo-btn flex min-h-[42px] items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{isCustomer ? 'Sign out' : language === 'zh' ? '退出' : 'Sign out'}</span>
            </button>
          </div>
        </div>
        {tabs.length > 1 && (
          <nav
            className="mx-auto flex w-full max-w-[1660px] gap-1 overflow-x-auto px-3 pb-2 sm:px-6 lg:px-10"
            aria-label={isCustomer ? 'Customer sections' : 'Internal sections'}
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
                  {language === 'zh' && !isCustomer ? label.zh : label.en}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1660px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
        {activeTab === 'catalog' && (
          <CustomerCatalogView onOpenCart={() => setActiveTab('cart')} />
        )}
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
      </main>

      <footer className="border-t border-[var(--line)] bg-white py-4 text-center text-[10px] tracking-wide text-[var(--muted)]">
        AOKING DIRECT · ROUND 2 UI UAT
        <span className="ml-2 inline-flex items-center gap-1">
          <Smartphone className="w-3 h-3" /> 375–1440 px
        </span>
      </footer>
    </div>
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
