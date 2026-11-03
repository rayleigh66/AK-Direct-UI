/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { AccessBoundary } from '../AccessBoundary';
import {
  Mail,
  Copy,
  CheckCircle2,
  Send,
  Building,
  ShieldAlert,
  Inbox,
  ExternalLink,
} from 'lucide-react';

export const InternalMailboxView: React.FC = () => {
  const { currentRole, internalEmailTemplates, markEmailTemplateSent, currentSalesUser } = useApp();
  const [selectedMailId, setSelectedMailId] = useState<string | null>(
    internalEmailTemplates[0]?.id || null
  );
  const [copyToast, setCopyToast] = useState(false);

  const selectedMail = internalEmailTemplates.find(m => m.id === selectedMailId);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyToast(true);
    setTimeout(() => setCopyToast(false), 2000);
  };

  if (currentRole === 'customer') {
    return (
      <AccessBoundary
        title="内部邮件中心不对客户开放"
        message="客户不能查看内部邮件模板或销售备注。这是前端视图守卫；正式权限必须在后端再次校验。"
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-slate-900">
          业务员内部工作邮箱与通知模板中心 (Sales Internal Mailbox)
        </h1>
        <p className="text-xs text-slate-500">
          当前业务员邮箱: <span className="font-mono font-semibold text-slate-800">{currentSalesUser.internal_email}</span> · 客户隐私防泄露安全通道
        </p>
      </div>

      {/* Compliance Callout Banner */}
      <div className="p-4 bg-slate-900 text-slate-200 rounded-2xl border border-slate-800 space-y-1.5 text-xs leading-relaxed">
        <div className="flex items-center gap-2 text-amber-400 font-bold">
          <ShieldAlert className="w-4 h-4" />
          <span>PRD D27 / D30 客户隐私保护与邮件代发规定：</span>
        </div>
        <p>
          1. 平台<strong>严格不收集也不存储</strong>客户邮箱、姓名与收件地址簿；
          2. 当订单确认、到账或发货时，平台自动生成高水准正式客户通知邮件模板（标准英文），投递至负责业务员的<strong>内部工作邮箱</strong>；
          3. 业务员核实后，通过公司企业邮箱（Outlook 等线下安全渠道）对外发送客户。
          <strong>内部邮件投递成功不等于客户已送达</strong>，业务员需线下核实发送。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Col: Mail List */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100 shadow-sm">
          <div className="p-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-600 flex items-center justify-between">
            <span>内部收件箱 ({internalEmailTemplates.length})</span>
            <Inbox className="w-4 h-4 text-slate-400" />
          </div>

          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {internalEmailTemplates.map(template => {
              const isSelected = selectedMailId === template.id;
              return (
                <div
                  key={template.id}
                  onClick={() => setSelectedMailId(template.id)}
                  className={`p-3.5 cursor-pointer text-xs transition-colors ${
                    isSelected ? 'bg-indigo-50/70 border-l-4 border-indigo-600' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-bold text-slate-900 truncate">
                      {template.recipient_company_name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {template.created_at.slice(11, 16)}
                    </span>
                  </div>

                  <div className="font-medium text-slate-800 line-clamp-1 mb-1 text-[11px]">
                    {template.subject}
                  </div>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-mono text-slate-500">
                      {template.recipient_company_code}
                    </span>
                    {template.status === 'sent_offline' ? (
                      <span className="text-emerald-700 font-semibold flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>已线下发送</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 font-semibold">待审核发送</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 2 Cols: Email Content Viewer */}
        <div className="md:col-span-2">
          {selectedMail ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
              {/* Email Meta Header */}
              <div className="space-y-2 pb-4 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold">
                    事件: {selectedMail.event_type}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(selectedMail.body_text)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>复制正文</span>
                    </button>

                    {selectedMail.status !== 'sent_offline' ? (
                      <button
                        onClick={() => markEmailTemplateSent(selectedMail.id)}
                        className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 flex items-center gap-1.5 transition-colors shadow-sm"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>标记已通过企业邮箱发出</span>
                      </button>
                    ) : (
                      <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>已于 {selectedMail.sent_by_sales_at?.slice(11, 16)} 标记发出</span>
                      </span>
                    )}
                  </div>
                </div>

                <h2 className="text-base font-bold text-slate-900 leading-snug">
                  {selectedMail.subject}
                </h2>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 pt-1">
                  <div>
                    投递邮箱: <span className="font-mono text-slate-800">{selectedMail.sales_rep_email}</span>
                  </div>
                  <div>
                    目标客户主体: <strong className="text-slate-800">{selectedMail.recipient_company_name}</strong> ({selectedMail.recipient_company_code})
                  </div>
                </div>
              </div>

              {copyToast && (
                <div className="p-2 bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs rounded-xl flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>英文邮件全文已复制到剪贴板！可直接粘贴至企业邮箱对外发送。</span>
                </div>
              )}

              {/* Email Body Plain Text */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap select-all">
                {selectedMail.body_text}
              </div>

              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <ExternalLink className="w-3.5 h-3.5" />
                <span>
                  业务员请通过企业邮箱（如 tom.m@aoking-luggage.com）将上述模板发送至客户线下建档的采购联系人邮箱。
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
              请在左侧选择一封邮件模板预览
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
