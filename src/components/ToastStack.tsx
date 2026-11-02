/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { Check, AlertCircle, Info, X } from 'lucide-react';

export const ToastStack: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[150] flex flex-col gap-2.5 max-w-[calc(100vw-32px)] pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-[#202020] text-white px-4 py-3 rounded-[10px] text-xs flex items-center gap-3 shadow-[0_8px_35px_rgba(0,0,0,0.2)] animate-in fade-in slide-in-from-bottom-2 duration-200 border border-white/10"
        >
          {toast.type === 'warn' ? (
            <AlertCircle className="w-4 h-4 text-[#ff8c4e] shrink-0" />
          ) : toast.type === 'info' ? (
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
          ) : (
            <Check className="w-4 h-4 text-[#ff8c4e] shrink-0 stroke-[2.5]" />
          )}
          <span className="font-medium text-slate-100">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-slate-400 hover:text-white ml-2 p-0.5 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
