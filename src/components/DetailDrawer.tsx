/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import {
  X,
  ArrowRight,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Truck,
  DollarSign,
  PackageCheck,
  Building,
} from 'lucide-react';
import { calculateSKUAvailableStock, calculateEffectiveUnitPrice, SKU_MOQ } from '../utils/rules';
import { ProductDetailSheet } from './CustomerViews/ProductDetailSheet';

export const DetailDrawer: React.FC = () => {
  const {
    currentRole,
    activeDrawer,
    closeDrawer,
    orders,
    products,
    inventory,
    promotions,
    currentCompanyTierInfo,
    companies,
    internalEmailTemplates,
    addToast,
    setActiveTab,
  } = useApp();

  if (!activeDrawer) return null;

  const { type, id } = activeDrawer;
  if (type === 'sku' && currentRole === 'customer') {
    return <ProductDetailSheet skuId={id} onClose={closeDrawer} />;
  }
  const tierDiscount = currentCompanyTierInfo?.currentTier.discount_rate ?? 0;

  let title = '';
  let sub = '';
  let bodyContent = null;
  let footerActions = null;

  if (type === 'order') {
    const o = orders.find(x => x.id === id || x.order_no === id);
    if (!o) return null;
    const comp = companies.find(c => c.id === o.company_id);
    title = o.order_no;
    sub = `销售订购单详情 · ${comp?.short_name || '客户'}`;

    const totalPcs = o.lines.reduce((s, l) => s + l.quantity, 0);

    bodyContent = (
      <div className="space-y-5">
        <div className="p-4 bg-[#f8f8f6] border border-[#eeeee9] rounded-[12px]">
          <h3 className="text-base font-bold text-[#151515] m-0">
            {o.lines[0]?.product_title || '现货商品组合'}
          </h3>
          <p className="text-xs text-[#999] mt-1">
            下单账号: {o.created_by_username} · 目的国: {o.destination_country_alpha3}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">订购总数</small>
            <b className="font-mono text-xs text-[#151515]">{totalPcs} PCS</b>
          </div>
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">期望交期</small>
            <b className="font-mono text-xs text-[#151515]">{o.expected_ship_date}</b>
          </div>
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">执行状态</small>
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-[#fff1e8] text-[#ff681e]">
              {o.status}
            </span>
          </div>
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">参考总金额</small>
            <b className="font-mono text-xs text-[#151515]">
              USD ${(o.total_confirmed_usd || o.total_quoted_usd).toFixed(2)}
            </b>
          </div>
        </div>

        {/* Progress Track */}
        <div>
          <h4 className="text-xs font-bold text-[#151515] mb-2">订单状态与履约跟踪</h4>
          <div className="w-full h-2.5 bg-[#f0f0ed] rounded-[8px] overflow-hidden">
            <div
              className="h-full bg-[#ff681e] rounded-[8px]"
              style={{
                width:
                  o.status === 'COMPLETED' || o.status === 'DELIVERED'
                    ? '100%'
                    : o.status === 'SHIPPED'
                    ? '80%'
                    : o.status === 'PAYMENT_RECORDED'
                    ? '60%'
                    : o.status === 'CONFIRMED'
                    ? '40%'
                    : '20%',
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[#aaa] mt-1.5">
            <span>已提交申请</span>
            <span>业务员确认</span>
            <span>到账入账</span>
            <span>整单出库</span>
          </div>
        </div>

        {/* Order Lines */}
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-bold text-[#151515]">订购 SKU 明细</h4>
          <div className="border border-[#e8e8e6] rounded-[11px] overflow-hidden divide-y divide-[#f0f0ef]">
            {o.lines.map((l, i) => (
              <div key={i} className="p-3 text-xs flex items-center justify-between">
                <div>
                  <div className="font-mono font-bold text-[#151515]">{l.sku_code}</div>
                  <div className="text-[11px] text-[#858789]">
                    {l.color_name} · {l.quantity} PCS
                  </div>
                </div>
                <div className="text-right font-mono font-bold text-[#151515]">
                  ${l.line_subtotal.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Visible Note */}
        {o.customer_visible_note && (
          <div className="p-3.5 bg-[#fff6ef] border border-[#ffeadb] rounded-[10px] text-[#ae683e] text-xs leading-relaxed">
            <strong>业务员反馈说明:</strong> {o.customer_visible_note}
          </div>
        )}

        {/* Logistics */}
        {o.tracking_no && (
          <div className="p-3.5 bg-[#eaf7f0] border border-[#cbe9d7] rounded-[10px] text-[#198364] text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Truck className="w-4 h-4" />
              <span>整单发货跟踪 (Whole Order Tracking)</span>
            </div>
            <div>承运商: {o.carrier}</div>
            <div>国际运单号: <strong className="font-mono">{o.tracking_no}</strong></div>
            <div>实际发货日: {o.actual_ship_date}</div>
          </div>
        )}
      </div>
    );

    footerActions = (
      <button
        onClick={() => {
          closeDrawer();
          setActiveTab('orders');
        }}
        className="px-4 py-2 bg-[#ff681e] text-white rounded-[9px] text-xs font-bold hover:bg-[#ed5610] transition-colors flex items-center gap-1.5 shadow-[0_4px_12px_rgba(255,104,30,0.2)]"
      >
        <span>前往我的订单列表</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    );
  } else if (type === 'sku') {
    let targetSku = null;
    let targetProduct = null;
    for (const p of products) {
      const s = p.skus.find(x => x.id === id || x.sku_code === id);
      if (s) {
        targetSku = s;
        targetProduct = p;
        break;
      }
    }
    if (!targetSku || !targetProduct) return null;

    const { totalAvailable, totalOnHand, totalReserved, totalUnsellable } =
      calculateSKUAvailableStock(targetSku.id, inventory);

    const priceInfo = calculateEffectiveUnitPrice(
      targetSku.base_price_usd,
      targetSku.id,
      tierDiscount,
      promotions
    );

    title = targetSku.sku_code;
    sub = `现货 SKU 规格详情 · ${targetProduct.title}`;

    bodyContent = (
      <div className="space-y-5">
        <div className="relative aspect-[16/10] bg-slate-100 rounded-[12px] overflow-hidden border border-[#e8e8e6]">
          <img
            src={targetProduct.primary_image}
            alt={targetProduct.title}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="p-4 bg-[#f8f8f6] border border-[#eeeee9] rounded-[12px]">
          <h3 className="text-base font-bold text-[#151515] m-0">
            {targetProduct.title}
          </h3>
          <p className="text-xs text-[#999] mt-1 font-mono">
            {targetSku.sku_code} · {targetSku.color_name}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">参考批发单价</small>
            <b className="font-mono text-sm text-[#198364]">
              USD ${priceInfo.effectivePrice.toFixed(2)}
            </b>
          </div>
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">基准原价</small>
            <b className="font-mono text-xs text-[#858789]">
              USD ${targetSku.base_price_usd.toFixed(2)}
            </b>
          </div>
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">多仓可订库存</small>
            <b
              className={`font-mono text-sm ${
                totalAvailable >= SKU_MOQ ? 'text-[#198364]' : 'text-[#d34f36]'
              }`}
            >
              {totalAvailable} PCS
            </b>
          </div>
          <div>
            <small className="block text-[#aaa] text-[10px] mb-1">起订量限制 (MOQ)</small>
            <b className="font-mono text-xs text-[#151515]">≥ 10 PCS</b>
          </div>
        </div>

        <div className="p-3 bg-[#f5f5f4] rounded-[10px] text-xs space-y-1 text-[#666]">
          <div className="flex justify-between">
            <span>账面实物库存 (On-hand):</span>
            <span className="font-mono font-semibold text-[#151515]">{totalOnHand} PCS</span>
          </div>
          <div className="flex justify-between">
            <span>有效业务预占 (Reserved):</span>
            <span className="font-mono font-semibold text-[#ff681e]">{totalReserved} PCS</span>
          </div>
          <div className="flex justify-between">
            <span>冻结/不良 (Unsellable):</span>
            <span className="font-mono font-semibold text-[#999]">{totalUnsellable} PCS</span>
          </div>
        </div>

        <div className="text-xs text-[#858789] leading-relaxed">
          <strong>工艺材质:</strong> {targetProduct.material} · 容量规格: {targetProduct.capacity_or_size}
        </div>
      </div>
    );

    footerActions = (
      <div className="max-w-[240px] text-right text-[11px] leading-relaxed text-slate-500">
        内部只读库存视图。客户加购与下单只能在客户角色完成；这是前端模拟边界，不是服务端 RBAC。
      </div>
    );
  } else if (type === 'mail') {
    const template = internalEmailTemplates.find(t => t.id === id);
    if (!template) return null;

    title = '业务员英文邮件模板';
    sub = `目标: ${template.recipient_company_name} (${template.recipient_company_code})`;

    bodyContent = (
      <div className="space-y-4">
        <div className="p-3 bg-[#f8f8f6] border border-[#eeeee9] rounded-[10px] text-xs space-y-1">
          <div>主题: <strong className="text-[#151515]">{template.subject}</strong></div>
          <div>业务员内部邮箱: <span className="font-mono text-[#666]">{template.sales_rep_email}</span></div>
        </div>

        <div className="bg-[#fcfcfb] p-4 rounded-[12px] border border-[#e8e8e6] font-mono text-xs whitespace-pre-wrap leading-relaxed select-all">
          {template.body_text}
        </div>
      </div>
    );

    footerActions = (
      <button
        onClick={() => {
          navigator.clipboard.writeText(template.body_text);
          addToast('已复制邮件正文到剪贴板！');
          closeDrawer();
        }}
        className="px-4 py-2 bg-[#191919] text-white rounded-[9px] text-xs font-bold hover:bg-black transition-colors flex items-center gap-1.5"
      >
        <Copy className="w-3.5 h-3.5" />
        <span>复制邮件全文</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#101010]/40 backdrop-blur-[3px] transition-opacity"
        onClick={closeDrawer}
      />

      {/* Drawer Container (FactoryOS styling) */}
      <div className="fixed right-0 top-0 bottom-0 bg-white w-full max-w-[500px] z-[81] shadow-[-15px_0_60px_rgba(0,0,0,0.1)] flex flex-col animate-in slide-in-from-right duration-250">
        {/* Drawer Header */}
        <div className="p-6 sm:p-7 border-b border-[#eee] flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-[#8f9191] tracking-[1.7px] uppercase">
              <span className="w-4 h-[2px] bg-[#ff681e]" />
              <span>RECORD DETAILS</span>
            </div>
            <div className="text-lg font-extrabold text-[#151515] tracking-tight mt-2">
              {title}
            </div>
            <div className="text-xs text-[#aaa] mt-1">{sub}</div>
          </div>
          <button
            onClick={closeDrawer}
            className="w-9 h-9 border border-[#e8e8e6] rounded-[10px] bg-white flex items-center justify-center text-[#4f5150] hover:bg-[#f6f6f4] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="p-6 sm:p-7 overflow-y-auto flex-1">{bodyContent}</div>

        {/* Drawer Footer */}
        <div className="p-4 sm:p-5 border-t border-[#eee] bg-[#fafaf9] flex items-center justify-end gap-2.5">
          <button
            onClick={closeDrawer}
            className="px-4 py-2 border border-[#e8e8e6] bg-white text-[#343434] text-xs font-semibold rounded-[9px] hover:border-[#ccc] transition-colors"
          >
            关闭
          </button>
          {footerActions}
        </div>
      </div>
    </div>
  );
};
