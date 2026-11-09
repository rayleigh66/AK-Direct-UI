import React from 'react';
import { Calendar } from 'lucide-react';
import { formatEnglishDate } from '../../utils/dateDisplay';

interface EnglishDateFieldProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  testId?: string;
  required?: boolean;
  min?: string;
  className?: string;
}

/**
 * The visible closed state is always an explicit English date, independent of
 * the browser/system locale. A transparent native date input covers the field
 * so the platform picker, keyboard entry and mobile tap targets still work; the
 * value remains the backend ISO YYYY-MM-DD string.
 */
export const EnglishDateField: React.FC<EnglishDateFieldProps> = ({
  value,
  onChange,
  ariaLabel,
  testId,
  required,
  min,
  className = '',
}) => (
  <label
    className={`relative flex h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)] focus-within:border-[var(--orange)] focus-within:ring-2 focus-within:ring-[var(--orange)]/25 ${className}`}
  >
    <Calendar className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
    <span aria-hidden="true" data-testid={testId ? `${testId}-display` : undefined} className="truncate">
      {value ? formatEnglishDate(value) : 'Select date'}
    </span>
    <input
      type="date"
      value={value}
      onChange={event => onChange(event.target.value)}
      aria-label={ariaLabel}
      data-testid={testId}
      required={required}
      min={min}
      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
    />
  </label>
);
