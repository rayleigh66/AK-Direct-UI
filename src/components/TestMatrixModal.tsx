/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileCheck,
  CheckCircle2,
  X,
  ExternalLink,
  ChevronRight,
  Shield,
  Layers,
  Clock,
  DollarSign,
  Truck,
  Users,
} from 'lucide-react';

interface TestMatrixModalProps {
  onClose: () => void;
}

export const TestMatrixModal: React.FC<TestMatrixModalProps> = ({ onClose }) => {
  const { switchRole, setActiveTab } = useApp();
  const [activeCategory, setActiveCategory] = useState<'all' | 'auth' | 'moq' | 'order' | 'tier' | 'privacy'>('all');

  const testCases = [
    {
      id: 'T01',
      category: 'auth',
      title: '同公司两个账户登录',
      expectation: 'AK000123A 与 AK000123B 凭据独立，但共享 Apex Luggage Co. 的等级、折扣与全部平台订单。',
      action: () => {
        switchRole('customer', 'user-001b');
        setActiveTab('orders');
        onClose();
      },
      actionLabel: '切换到 AK000123B 查看共享订单',
    },
    {
      id: 'T02',
      category: 'auth',
      title: '客户访问未授权品牌 SKU 保护',
      expectation: '客户访问未获授权的 VOYAGER 品牌时，服务端拒绝，不泄露价格和现货库存。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('catalog');
        onClose();
      },
      actionLabel: '在商城切换至 VOYAGER 品牌验证受限提示',
    },
    {
      id: 'T03',
      category: 'moq',
      title: '单 SKU 下单数量 9 / 10 / 11 件校验',
      expectation: '输入 9 件起订量校验拦截报错；输入 10 或 11 件且库存充足时允许加入订购清单。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('catalog');
        onClose();
      },
      actionLabel: '前往商城选款测试数量加减与 MOQ',
    },
    {
      id: 'T04',
      category: 'moq',
      title: '不同颜色不可合并达到起订量 10',
      expectation: '黑色 6 件 + 灰色 4 件分别低于 10 件，各自均被拒绝，不可跨 SKU 凑起订量。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('catalog');
        onClose();
      },
      actionLabel: '在商品详情查看独立 SKU 校验规则',
    },
    {
      id: 'T05',
      category: 'moq',
      title: '整单无最低金额限制 (No MOV)',
      expectation: '只要每个 SKU 独立满足 ≥ 10 PCS，无论整单总价多低均可提交订购申请。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('cart');
        onClose();
      },
      actionLabel: '查看订购清单规则说明',
    },
    {
      id: 'T06',
      category: 'moq',
      title: '缺货或库存不足起订量 (如 6 件)',
      expectation: 'AK-9042-NAV (0件) 与 AK-9042-OLV (6件) 禁止正常下单，直接提供 Request Restock。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('catalog');
        onClose();
      },
      actionLabel: '在商城点击缺货 SKU 体验补货申请',
    },
    {
      id: 'T07',
      category: 'order',
      title: '整单模拟预占（Demo，非数据库事务）',
      expectation: '业务员确认订单时先按多仓可订量规划整单；任一 SKU 不足则整单失败，不出现部分锁定。前端 Mock 不宣称数据库事务。',
      action: () => {
        switchRole('sales');
        setActiveTab('sales_orders');
        onClose();
      },
      actionLabel: '切换业务员端体验整单模拟预占',
    },
    {
      id: 'T10',
      category: 'order',
      title: '业务员延期预占 (+48小时)',
      expectation: '预占到期前业务员可点击延期，更新截止时间并记录审计日志。',
      action: () => {
        switchRole('sales');
        setActiveTab('sales_orders');
        onClose();
      },
      actionLabel: '在业务员订单台点击【延期预占】',
    },
    {
      id: 'T12',
      category: 'order',
      title: '已提交未确认订单可直接修改/取消',
      expectation: '待确认状态的订单，客户拥有完全自由修改数量或撤回取消的权限。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('orders');
        onClose();
      },
      actionLabel: '前往我的订单查看待确认订单直接修改/取消',
    },
    {
      id: 'T13',
      category: 'order',
      title: '已确认订单取消须申请业务员审核',
      expectation: '已确认锁定库存的订单，客户点击取消需提交理由，由负责业务员审核批准后方释放库存。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('orders');
        onClose();
      },
      actionLabel: '在已确认订单点击【申请取消】',
    },
    {
      id: 'T14',
      category: 'order',
      title: '已付款订单原则上禁止普通取消',
      expectation: 'PAYMENT_RECORDED 状态订单不提供普通取消入口，提示通过线下专属渠道联系业务员。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('orders');
        onClose();
      },
      actionLabel: '查看已付款订单 ORD-20261020-002 的防取消提示',
    },
    {
      id: 'T15',
      category: 'order',
      title: '整单发货规则 (不支持部分发货)',
      expectation: '出库履约严格整单发货，录入承运商、国际运单号与预计送达时间。',
      action: () => {
        switchRole('sales');
        setActiveTab('sales_orders');
        onClose();
      },
      actionLabel: '业务员端查看整单出库发货录入',
    },
    {
      id: 'T16',
      category: 'privacy',
      title: '内外备注安全隔离',
      expectation: '业务员录入的内部跟单备注仅内部可见，绝不泄露到客户订单时间轴与对外导出中。',
      action: () => {
        switchRole('sales');
        setActiveTab('sales_orders');
        onClose();
      },
      actionLabel: '在业务员订单台查看内外备注字段对比',
    },
    {
      id: 'T18',
      category: 'tier',
      title: '限时促销与等级折扣叠加规则',
      expectation: 'AK-8015-NVY 开启叠加，价格=促销价×(1-等级折扣)；AK-7710-GLD 默认不叠加，价格=促销一口价。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('catalog');
        onClose();
      },
      actionLabel: '在商城查看两款促销商品的单价计算对比',
    },
    {
      id: 'T19',
      category: 'tier',
      title: '登记付款入账并更新历史采购额',
      expectation: '业务员登记电汇实收到账金额，实时全额累加进客户公司历史采购额并重置未采购计时。',
      action: () => {
        switchRole('sales');
        setActiveTab('sales_orders');
        onClose();
      },
      actionLabel: '在已确认订单点击【登记到账入账】',
    },
    {
      id: 'T20',
      category: 'tier',
      title: '历史有效采购含线下，不展示线下明细',
      expectation: '会员中心展示历史累计采购总额与平台订单，根据 D19 绝不展示线下历史订单明细。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('membership');
        onClose();
      },
      actionLabel: '前往会员中心查看数据边界说明',
    },
    {
      id: 'T21',
      category: 'tier',
      title: '未采购满 18/30/42 个月逐级降级与恢复定级',
      expectation: '距最近采购满 18 个月降 1 级，满 30 个月降 2 级；新采购入账后按累计额重新定级并重置计时。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('membership');
        onClose();
      },
      actionLabel: '在会员中心使用【时间快进测试控制台】体验实时降级与恢复',
    },
    {
      id: 'T24',
      category: 'moq',
      title: '补货达到起订量通知客户且不锁库',
      expectation: '当仓库现货恢复 ≥ 10 PCS 时，触发站内通知与业务员英文邮件草稿，绝不自动预占。',
      action: () => {
        switchRole('sales');
        setActiveTab('restock_manage');
        onClose();
      },
      actionLabel: '在补货需求台点击【入库 +100 PCS 并通知客户】',
    },
    {
      id: 'T25',
      category: 'privacy',
      title: '数据库与系统日志隐私合规审查',
      expectation: '允许公司简称/客户号/国家码；严禁存在客户姓名、电话、邮箱、物理街道地址或明文密码。',
      action: () => {
        switchRole('admin');
        setActiveTab('audit_logs');
        onClose();
      },
      actionLabel: '在审计日志点击【运行 T25 隐私合规审查】',
    },
    {
      id: 'T27',
      category: 'auth',
      title: '业务员越权创建客户/账户拦截',
      expectation: '业务员角色无权建档或创建登录账号，界面与接口层面严格拦截。',
      action: () => {
        switchRole('sales');
        setActiveTab('admin_companies');
        onClose();
      },
      actionLabel: '在业务员角色下进入客户建档查看 RBAC 拦截提示',
    },
    {
      id: 'T28',
      category: 'auth',
      title: '两步建档与一次性临时密码生成',
      expectation: '管理员输入 C000123 / 简称 / 国家代码，系统自动派生 AK000123A 并高强度生成一次性临时密码。',
      action: () => {
        switchRole('admin');
        setActiveTab('admin_companies');
        onClose();
      },
      actionLabel: '前往管理员客户建档体验两步开户',
    },
    {
      id: 'T31',
      category: 'auth',
      title: '首次登录强制修改正式密码',
      expectation: '未修改临时密码的账号 (如 AK000456A) 登录后禁止访问任何业务页面，强制完成改密。',
      action: () => {
        switchRole('customer', 'user-002a');
        onClose();
      },
      actionLabel: '切换到 AK000456A 体验首次登录强制改密',
    },
    {
      id: 'T34',
      category: 'privacy',
      title: '自由文本输入电话/邮箱/地址实时拦截',
      expectation: '订购清单备注中若输入手机号、邮箱或街道关键词，系统前端与规则层即时拦截。',
      action: () => {
        switchRole('customer', 'user-001a');
        setActiveTab('cart');
        onClose();
      },
      actionLabel: '在订购清单备注尝试输入邮箱或电话测试拦截',
    },
  ];

  const filteredCases = testCases.filter(t => {
    if (activeCategory === 'all') return true;
    return t.category === activeCategory;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Top Header */}
        <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold">AOKING Direct PRD v0.3 核心验收场景矩阵 (T01 - T35)</h2>
              <p className="text-xs text-slate-300">
                点击每条场景右侧按钮即可一键切换角色与视口，现场验证各项业务规则
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2 overflow-x-auto">
          {[
            { id: 'all', label: '全部场景 (22项)' },
            { id: 'auth', label: '账户与权限 (T01/T02/T27/T28/T31)' },
            { id: 'moq', label: '起订量与补货 (T03-T06/T24)' },
            { id: 'order', label: '订单与预占锁库 (T07-T15)' },
            { id: 'tier', label: '等级与降级算法 (T18-T21)' },
            { id: 'privacy', label: '隐私防泄露安全 (T16/T25/T34)' },
          ].map(c => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeCategory === c.id
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Test Cases List */}
        <div className="p-5 overflow-y-auto space-y-3">
          {filteredCases.map(tc => (
            <div
              key={tc.id}
              className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-xs px-2 py-0.5 rounded bg-slate-900 text-white">
                    {tc.id}
                  </span>
                  <span className="font-bold text-xs text-slate-900">{tc.title}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {tc.expectation}
                </p>
              </div>

              <button
                onClick={tc.action}
                className="min-h-[44px] px-3.5 py-1.5 bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-800 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 shrink-0 self-start md:self-center"
              >
                <span>{tc.actionLabel}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
