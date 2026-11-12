import React from 'react';
import type { OrderLanguage } from '../../utils/orderStatus';

interface LanguageToggleProps {
  value: OrderLanguage;
  onChange: (value: OrderLanguage) => void;
  label: string;
  testId?: string;
}

export const LanguageToggle: React.FC<LanguageToggleProps> = ({
  value,
  onChange,
  label,
  testId,
}) => (
  <div
    role="group"
    aria-label={label}
    data-testid={testId}
    className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-0.5"
  >
    {(
      [
        { id: 'zh', label: '中文' },
        { id: 'en', label: 'EN' },
      ] as const
    ).map(item => (
      <button
        key={item.id}
        type="button"
        aria-pressed={value === item.id}
        onClick={() => onChange(item.id)}
        className={`min-h-[32px] rounded-[9px] px-2.5 text-[11px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
          value === item.id
            ? 'bg-slate-900 text-white'
            : 'text-slate-500 hover:text-slate-900'
        }`}
      >
        {item.label}
      </button>
    ))}
  </div>
);
