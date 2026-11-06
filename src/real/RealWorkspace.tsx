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
import { RealCartProvider, useRealCart } from './cart';

type TabKey = 'catalog' | 'cart' | 'orders' | 'products' | 'inventory' | 'import' | 'setup';

const TAB_LABELS: Record<TabKey, { en: string; zh?: string; icon: React.ReactNode }> = {
  catalog: { en: 'Catalogue', icon: <Package className="w-4 h-4" /> },
  cart: { en: 'Cart', icon: <ShoppingCart className="w-4 h-4" /> },
  orders: { en: 'Orders', zh: '订单', icon: <ClipboardList className="w-4 h-4" /> },
  products: { en: 'Products', zh: '商品', icon: <Package className="w-4 h-4" /> },
  inventory: { en: 'Inventory', zh: '库存', icon: <Boxes className="w-4 h-4" /> },
  import: { en: 'Import', zh: '导入', icon: <Upload className="w-4 h-4" /> },
  setup: { en: 'Setup', zh: '基础设置', icon: <Settings2 className="w-4 h-4" /> },
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
      className="min-h-[42px] px-3 rounded-xl border border-white/20 text-xs font-semibold flex items-center gap-2 hover:bg-white/10"
    >
      <span className="relative">
        <ShoppingCart className="w-4 h-4" />
        {cart.itemCount > 0 && (
          <span className="absolute -top-2 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#ff681e] text-white text-[9px] font-bold grid place-items-center">
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
  const can = (permission: string) => user.permissions.includes(permission);
  const tabs = useMemo<TabKey[]>(() => {
    if (isCustomer) return ['catalog', 'cart', 'orders'];
    const result: TabKey[] = [];
    if (can('catalog.manage')) {
      result.push('products', 'inventory', 'import', 'setup');
    } else if (can('inventory.read') || can('inventory.manage')) {
      result.push('inventory');
    }
    if (can('sales.read_all') || can('sales.read_assigned')) {
      result.push('orders');
    }
    return result.length ? result : ['inventory'];
  }, [isCustomer, user.permissions]);

  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]);

  return (
    <div className="min-h-screen bg-[#f8f8f6] text-[#151515] flex flex-col">
      <header className="bg-[#171717] text-white">
        <div className="px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold tracking-[2px] uppercase text-[#ff843f]">
              AOKING Direct · Phase 4B-04
            </div>
            <div className="text-base sm:text-lg font-extrabold tracking-tight">
              {isCustomer
                ? 'Catalogue, cart and orders'
                : 'Catalogue, inventory and orders / 商品、库存与订单'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isCustomer && <CartBadge onOpen={() => setActiveTab('cart')} />}
            <div className="text-right text-[11px] leading-tight max-w-[160px] sm:max-w-none">
              <div className="font-semibold truncate">{user.displayName}</div>
              {isCustomer ? (
                <div className="text-slate-400 truncate">
                  {user.companyName} ({user.companyCode})
                </div>
              ) : (
                <>
                  <div className="text-slate-400 font-mono truncate">{user.username}</div>
                  <div className="text-slate-400">{user.roles.join(' · ')}</div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              aria-label="Sign out"
              className="min-h-[42px] px-3 rounded-xl border border-white/20 text-xs font-semibold flex items-center gap-2 hover:bg-white/10"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{isCustomer ? 'Sign out' : 'Sign out / 退出'}</span>
            </button>
          </div>
        </div>
        {tabs.length > 1 && (
          <nav className="px-2 sm:px-6 flex gap-1 overflow-x-auto border-t border-white/10">
            {tabs.map(tab => {
              const label = TAB_LABELS[tab];
              const active = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  data-testid={`real-tab-${tab}`}
                  className={`px-3 sm:px-4 py-3 text-xs font-semibold flex items-center gap-2 whitespace-nowrap border-b-2 transition-colors ${
                    active
                      ? 'border-[#ff681e] text-white'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {label.icon}
                  {label.en}
                  {label.zh && <span className="text-[10px] text-slate-500">{label.zh}</span>}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      <main className="flex-1 w-full max-w-[1660px] mx-auto px-3 sm:px-6 lg:px-10 py-5 sm:py-8">
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
      </main>

      <footer className="text-center py-6 text-[10px] tracking-wide text-[#b0b0ae] border-t border-[#e8e8e6] bg-white">
        AOKING DIRECT · PHASE 4B-04 PILOT &nbsp; / &nbsp;{' '}
        {isCustomer
          ? 'Order requests are pending sales confirmation; stock is not reserved.'
          : '真实 PostgreSQL 数据 · 订单确认为只读，Phase 4B-05 开放'}
        <span className="inline-flex items-center gap-1 ml-2">
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
    <WorkspaceShell user={user} onSignOut={onSignOut} />
  </RealCartProvider>
);

export const LoadingBlock: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex items-center gap-2 text-xs text-slate-500 py-10 justify-center">
    <RefreshCw className="w-4 h-4 animate-spin" />
    {label}
  </div>
);

export const ErrorBlock: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => (
  <div
    role="alert"
    className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex flex-wrap items-center gap-3"
  >
    <span className="flex-1">{message}</span>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold"
      >
        Retry / 重试
      </button>
    )}
  </div>
);
