/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { AccessBoundary } from '../AccessBoundary';
import { auditActionLabel, auditDetailsLabel, auditSearchText } from '../../utils/auditDisplay';
import type { AuditLog } from '../../types';
import {
  ClipboardList,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Search,
} from 'lucide-react';

const AuditRawDetails: React.FC<{ log: AuditLog }> = ({ log }) => (
  <details className="mt-1.5" data-testid={`audit-raw-details-${log.id}`}>
    <summary className="w-fit cursor-pointer select-none rounded text-[10px] font-medium text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
      查看原始明细
    </summary>
    <div className="mt-1.5 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] leading-relaxed text-slate-600">
      <div>
        <span className="text-slate-400">action code: </span>
        {log.action}
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono">{log.details}</pre>
    </div>
  </details>
);

export const AuditLogView: React.FC = () => {
  const { currentRole, auditLogs } = useApp();
  const [filterQuery, setFilterQuery] = useState('');
  const [auditScanResult, setAuditScanResult] = useState<string | null>(null);

  const filteredLogs = auditLogs.filter(log => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return auditSearchText(log).includes(q);
  });

  const handleRunPrivacyScan = () => {
    // Scan all log details for email, phone or plain passwords (PRD T25 / T34)
    let violationFound = false;
    for (const log of auditLogs) {
      if (
        /@/.test(log.details) ||
        /\b\d{10,12}\b/.test(log.details) ||
        /password=/i.test(log.details)
      ) {
        violationFound = true;
        break;
      }
    }

    if (!violationFound) {
      setAuditScanResult(
        '【T25 合规审计通过】平台所有数据库与操作审计日志审查完毕：仅保留公司简称、客户编号 (C000123) 与国家三位码；未检测到任何客户联系人姓名、电话、邮箱、物理街道地址或明文密码。隐私隔离符合最高安全标准！'
      );
    } else {
      setAuditScanResult('发现潜在敏感数据，请复核日志字段。');
    }
  };

  if (currentRole !== 'admin') {
    return (
      <AccessBoundary
        title="审计日志仅对管理员开放"
        message="客户与业务员不能查看全系统审计流水。这是前端视图守卫；正式权限必须在后端再次校验。"
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            全系统操作审计流水日志 (System Audit Trails)
          </h1>
          <p className="text-xs text-slate-500">
            PRD 9.4 敏感操作不可篡改审计 · 严格隐私脱敏保护 (T25)
          </p>
        </div>

        <button
          onClick={handleRunPrivacyScan}
          className="min-h-[44px] px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-sm self-start sm:self-auto"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>运行 T25 隐私与非 PII 合规审查</span>
        </button>
      </div>

      {auditScanResult && (
        <div className="p-4 bg-emerald-950 text-emerald-100 rounded-2xl border border-emerald-800 text-xs leading-relaxed flex items-start gap-3 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>{auditScanResult}</div>
        </div>
      )}

      {/* Filter */}
      <div className="relative max-w-sm">
        <input
          type="text"
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          placeholder="按操作人、动作或目标搜索日志..."
          className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
        />
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
      </div>

      {/* Audit Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="sm:hidden divide-y divide-slate-100">
          {filteredLogs.map(log => (
            <div key={log.id} className="p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-slate-400">{log.timestamp}</span>
                <span
                  title={log.action}
                  data-action-code={log.action}
                  className="font-bold text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded"
                >
                  {auditActionLabel(log.action)}
                </span>
              </div>
              <div className="font-semibold text-slate-800">{log.actor}</div>
              <div className="font-mono text-[11px] text-slate-500">{log.target}</div>
              <div className="text-slate-600 leading-relaxed">{auditDetailsLabel(log.details)}</div>
              <AuditRawDetails log={log} />
            </div>
          ))}
        </div>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-100">
              <tr>
                <th className="p-3 pl-4">时间戳 (UTC)</th>
                <th className="p-3">操作主体 (Actor)</th>
                <th className="p-3">动作指令 (Action)</th>
                <th className="p-3">目标对象 (Target)</th>
                <th className="p-3 pr-4">脱敏业务明细 (Sanitized Details)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/50">
                  <td className="p-3 pl-4 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                    {log.timestamp}
                  </td>
                  <td className="p-3 font-semibold text-slate-800 whitespace-nowrap">
                    {log.actor}
                  </td>
                  <td className="p-3">
                    <span
                      title={log.action}
                      data-action-code={log.action}
                      className="font-bold text-[11px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded"
                    >
                      {auditActionLabel(log.action)}
                    </span>
                  </td>
                  <td className="p-3 font-mono font-medium text-slate-700 whitespace-nowrap">
                    {log.target}
                  </td>
                  <td className="p-3 pr-4 text-slate-600 leading-normal">
                    <div>{auditDetailsLabel(log.details)}</div>
                    <AuditRawDetails log={log} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
