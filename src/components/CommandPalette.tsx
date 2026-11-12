/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { customerProductTitle, customerSkuColor } from '../utils/customerDisplay';
import { isSkuVisibleToCustomer } from '../utils/catalogVisibility';
import { canAccessTab } from '../utils/roles';
import {
  Search,
  Store,
  ShoppingCart,
  Clock,
  Award,
  ClipboardList,
  Boxes,
  Mail,
  Users,
  Settings,
  Package,
  Layers,
  ArrowRight,
} from 'lucide-react';

export const CommandPalette: React.FC = () => {
  const {
    isCommandSearchOpen,
    setIsCommandSearchOpen,
    setActiveTab,
    products,
    orders,
    companies,
    openDrawer,
    currentRole,
    currentCompany,
    brandGrants,
  } = useApp();
  const customer = currentRole === 'customer';

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandSearchOpen(!isCommandSearchOpen);
      }
      if (e.key === 'Escape' && isCommandSearchOpen) {
        setIsCommandSearchOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandSearchOpen, setIsCommandSearchOpen]);

  useEffect(() => {
    if (isCommandSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setQuery('');
    }
  }, [isCommandSearchOpen]);

  if (!isCommandSearchOpen) return null;

  const q = query.trim().toLowerCase();

  // Navigation Items
  const customerNavItems = [
    { id: 'catalog', title: 'Catalog', desc: 'Browse SKUs and available stock', icon: Store },
    { id: 'cart', title: 'Order list', desc: 'Review quantities and submit a request', icon: ShoppingCart },
    { id: 'orders', title: 'My orders', desc: 'Track status, shipping and changes', icon: Clock },
    { id: 'membership', title: 'Membership', desc: 'Tier, discount and inactivity status', icon: Award },
  ];
  const salesNavItems = [
    { id: 'sales_orders', title: '业务员订单处理 (Sales Orders)', desc: '订单核准、整单模拟预占 72h 与付款登记', icon: ClipboardList },
    { id: 'restock_manage', title: '缺货补货需求 (Restock)', desc: '跟踪客户缺货需求与到货通知', icon: Boxes },
    { id: 'internal_mailbox', title: '业务员内部邮件中心 (Mailbox)', desc: '客户英文通知草稿与线下复制发送', icon: Mail },
  ];
  const adminNavItems = [
    { id: 'inventory_import', title: '库存管理与 Excel 导入 (Inventory)', desc: '多仓库存监控与批量导入模拟', icon: Layers },
    { id: 'admin_products', title: '商品目录管理 (Products)', desc: '商品、SKU、图片、系列与功能标签', icon: Package },
    { id: 'admin_companies', title: '客户公司与账号建档 (Accounts)', desc: '两步建档与一次性临时密码生成', icon: Users },
    { id: 'promo_tier', title: '促销与等级配置 (Promo & Tiers)', desc: '限时促销时间窗与等级门槛配置', icon: Settings },
    { id: 'audit_logs', title: '敏感操作审计日志 (Audit)', desc: '审计流水与隐私合规扫描', icon: ClipboardList },
  ];
  const internalNavItems = [...adminNavItems, ...salesNavItems].filter(item =>
    canAccessTab(currentRole, item.id)
  );
  const navItems = customer ? customerNavItems : internalNavItems;

  const matchedNav = navItems.filter(
    n => n.title.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q)
  );

  // Matched SKUs. Customer search must respect the company's brand grants,
  // product listing state and SKU sellable status.
  const matchedSkus = q
    ? products.flatMap(p => {
        const visibleSkus = customer
          ? p.skus.filter(s =>
              isSkuVisibleToCustomer(p, s, currentCompany?.id, brandGrants)
            )
          : p.skus;
        return visibleSkus
          .filter(
            s =>
              s.sku_code.toLowerCase().includes(q) ||
              s.color_name.toLowerCase().includes(q) ||
              customerSkuColor(s).toLowerCase().includes(q) ||
              p.title.toLowerCase().includes(q) ||
              customerProductTitle(p).toLowerCase().includes(q) ||
              p.product_code.toLowerCase().includes(q)
          )
          .map(s => ({ product: p, sku: s }));
      }).slice(0, 4)
    : [];

  // Matched Orders
  const matchedOrders = q && !customer
    ? orders
        .filter(
          o =>
            o.order_no.toLowerCase().includes(q) ||
            o.created_by_username.toLowerCase().includes(q) ||
            o.destination_country_alpha3.toLowerCase().includes(q)
        )
        .slice(0, 3)
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-[580px] bg-white rounded-[16px] shadow-[0_25px_100px_rgba(0,0,0,0.3)] border border-[#eaeae7] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="relative border-b border-[#eee]">
          <Search className="w-5 h-5 text-[#888] absolute top-6 left-6 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={customer ? 'Search products, SKUs or pages...' : '搜索功能、款号、SKU、客户或订单号...'}
            className="w-full h-[68px] pl-16 pr-6 text-sm text-[#151515] bg-transparent outline-none placeholder:text-[#999]"
          />
        </div>

        {/* Results Body */}
        <div className="p-3 max-h-[380px] overflow-y-auto space-y-1">
          {/* Matched Nav Sections */}
          {matchedNav.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[10px] font-bold text-[#a3a4a4] tracking-[1.5px] uppercase">
                {customer ? 'Pages' : '功能模块导航'}
              </div>
              {matchedNav.slice(0, 4).map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsCommandSearchOpen(false);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-[9px] hover:bg-[#f7f7f5] text-left transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#f4f4f2] text-[#333] group-hover:bg-[#171717] group-hover:text-[#ff843f] flex items-center justify-center transition-colors shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[#1f1f1f] truncate">{item.title}</div>
                      <div className="text-[11px] text-[#8c8d8c] truncate">{item.desc}</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[#aaa] group-hover:text-[#171717] shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Matched Products & SKUs */}
          {matchedSkus.length > 0 && (
            <div className="pt-2 border-t border-[#f0f0ef]">
              <div className="px-3 py-1.5 text-[10px] font-bold text-[#a3a4a4] tracking-[1.5px] uppercase">
                {customer ? 'Products & SKUs' : '匹配商品与 SKU'}
              </div>
              {matchedSkus.map(({ product, sku }) => (
                <button
                  key={sku.id}
                  onClick={() => {
                    openDrawer('sku', sku.id);
                    setIsCommandSearchOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-[9px] hover:bg-[#f7f7f5] text-left transition-colors group"
                >
                  <img
                    src={product.primary_image}
                    alt={customerProductTitle(product)}
                    width={32}
                    height={32}
                    loading="lazy"
                    decoding="async"
                    className="w-8 h-8 rounded-lg object-cover bg-slate-100 shrink-0 border border-slate-200"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#1f1f1f] truncate font-mono">
                      {sku.sku_code} · {customerSkuColor(sku)}
                    </div>
                    <div className="text-[11px] text-[#8c8d8c] truncate">{customerProductTitle(product)}</div>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#198364]">
                    ${sku.base_price_usd.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Matched Orders */}
          {matchedOrders.length > 0 && (
            <div className="pt-2 border-t border-[#f0f0ef]">
              <div className="px-3 py-1.5 text-[10px] font-bold text-[#a3a4a4] tracking-[1.5px] uppercase">
                匹配订购单
              </div>
              {matchedOrders.map(order => (
                <button
                  key={order.id}
                  onClick={() => {
                    openDrawer('order', order.id);
                    setIsCommandSearchOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-[9px] hover:bg-[#f7f7f5] text-left transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#f0f0ee] text-[#151515] flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold font-mono text-[#1f1f1f]">
                      {order.order_no}
                    </div>
                    <div className="text-[11px] text-[#8c8d8c]">
                      状态: {order.status} · 下单账号: {order.created_by_username}
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#151515]">
                    ${(order.total_confirmed_usd || order.total_quoted_usd).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {matchedNav.length === 0 && matchedSkus.length === 0 && matchedOrders.length === 0 && (
            <div className="p-8 text-center text-xs text-[#aaa]">
              {customer ? 'No matches. Try another keyword.' : '没有找到匹配的结果，请尝试输入其他关键词'}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 px-6 bg-[#fafaf9] border-t border-[#eee] flex items-center justify-between text-[11px] text-[#aaa]">
          <span>
            {customer ? 'Press' : '按'} <b className="bg-white border border-[#eee] px-1.5 py-0.5 rounded text-[#666]">ESC</b> {customer ? 'to close' : '关闭'}
          </span>
          <span>{customer ? 'AOKING Direct quick search' : 'AOKING Direct 全局快捷指令'}</span>
        </div>
      </div>
    </div>
  );
};
