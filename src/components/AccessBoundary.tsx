import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface AccessBoundaryProps {
  title: string;
  message: string;
}

/**
 * Frontend-only role boundary. It is deliberately not presented as server-side
 * authorisation; the backend must enforce the same rule again.
 */
export const AccessBoundary: React.FC<AccessBoundaryProps> = ({ title, message }) => (
  <div className="max-w-xl mx-auto p-8 bg-white border border-slate-200 rounded-2xl space-y-3">
    <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
      <ShieldAlert className="w-5 h-5 text-rose-600" />
      <span>{title}</span>
    </div>
    <p className="text-xs text-slate-600 leading-relaxed">{message}</p>
    <p className="text-[11px] text-slate-400 leading-relaxed">
      这是前端角色模拟保护，不是服务端 RBAC；正式权限必须在后端再次校验。
    </p>
  </div>
);
