import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatEnglishDate, toIsoDateOnly } from '../../utils/dateDisplay';

interface EnglishDateFieldProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  testId?: string;
  required?: boolean;
  min?: string;
  className?: string;
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseIso(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function isoFromParts(year: number, month: number, day: number): string {
  return toIsoDateOnly(new Date(Date.UTC(year, month, day)));
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

function monthOf(value: string): { year: number; month: number } {
  const parsed = parseIso(value);
  if (parsed) return { year: parsed.year, month: parsed.month };
  const today = parseIso(todayIso())!;
  return { year: today.year, month: today.month };
}

function addMonths(view: { year: number; month: number }, delta: number) {
  const date = new Date(Date.UTC(view.year, view.month + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function shiftIso(iso: string, days: number): string {
  const parsed = parseIso(iso);
  if (!parsed) return iso;
  const date = new Date(Date.UTC(parsed.year, parsed.month, parsed.day + days));
  return toIsoDateOnly(date);
}

/**
 * English-only date field with a real, clickable calendar. The closed state is
 * always `Nov 9, 2026` style; the submitted value stays the ISO date-only
 * string. No transparent native input or browser date picker is required.
 */
export const EnglishDateField: React.FC<EnglishDateFieldProps> = ({
  value,
  onChange,
  ariaLabel,
  testId,
  required,
  min,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(value));
  const today = todayIso();
  const selected = parseIso(value) ? value : '';
  const [activeIso, setActiveIso] = useState(selected || today);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarId = useId();
  const display = value ? formatEnglishDate(value) : 'Select date';

  const openCalendar = () => {
    const base = selected || today;
    setView(monthOf(base));
    setActiveIso(base);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${activeIso}"]`)
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIso, open, view]);

  const days = useMemo(() => {
    const first = new Date(Date.UTC(view.year, view.month, 1));
    const total = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
    const leading = first.getUTCDay();
    const cells: Array<string | null> = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= total; day += 1) {
      cells.push(isoFromParts(view.year, view.month, day));
    }
    return cells;
  }, [view]);

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  const choose = (iso: string) => {
    if (min && iso < min) return;
    onChange(iso);
    close();
  };

  const moveActive = (deltaDays: number) => {
    const next = shiftIso(activeIso, deltaDays);
    if (min && next < min) return;
    setView(monthOf(next));
    setActiveIso(next);
  };

  const moveMonth = (delta: number) => {
    const nextView = addMonths(view, delta);
    const parsed = parseIso(activeIso);
    const daysInNext = new Date(Date.UTC(nextView.year, nextView.month + 1, 0)).getUTCDate();
    const targetDay = parsed ? Math.min(parsed.day, daysInNext) : 1;
    setView(nextView);
    setActiveIso(isoFromParts(nextView.year, nextView.month, targetDay));
  };

  const onDayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-7);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(7);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const day = parseIso(activeIso);
      if (day) {
        const weekday = new Date(Date.UTC(day.year, day.month, day.day)).getUTCDay();
        moveActive(-weekday);
      }
    } else if (event.key === 'End') {
      event.preventDefault();
      const day = parseIso(activeIso);
      if (day) {
        const weekday = new Date(Date.UTC(day.year, day.month, day.day)).getUTCDay();
        moveActive(6 - weekday);
      }
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      moveMonth(-1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      moveMonth(1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIso);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`relative w-full ${className}`}
      data-testid={testId ? `${testId}-field` : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        data-value={value}
        aria-label={`${ariaLabel}: ${display}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={calendarId}
        aria-required={required || undefined}
        onClick={() => {
          if (open) close();
          else openCalendar();
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openCalendar();
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 text-left text-sm text-[var(--ink)] outline-none transition-colors hover:border-[var(--orange)] focus-visible:border-[var(--orange)] focus-visible:ring-2 focus-visible:ring-[var(--orange)]/25"
      >
        <Calendar className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <span
          aria-hidden="true"
          data-testid={testId ? `${testId}-display` : undefined}
          className={`min-w-0 flex-1 truncate ${value ? '' : 'text-[var(--muted)]'}`}
        >
          {display}
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={calendarId}
          role="dialog"
          aria-label={`${ariaLabel} calendar`}
          data-testid={testId ? `${testId}-calendar` : undefined}
          className="absolute left-0 top-[calc(100%+6px)] z-[90] w-[292px] max-w-[calc(100vw-24px)] rounded-2xl border border-[var(--line)] bg-white p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              aria-label="Previous month"
              data-testid={testId ? `${testId}-prev-month` : undefined}
              onClick={() => moveMonth(-1)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--subtle-bg)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div
              className="text-xs font-extrabold"
              data-testid={testId ? `${testId}-month` : undefined}
            >
              {MONTH_LABEL.format(new Date(Date.UTC(view.year, view.month, 1)))}
            </div>
            <button
              type="button"
              aria-label="Next month"
              data-testid={testId ? `${testId}-next-month` : undefined}
              onClick={() => moveMonth(1)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--subtle-bg)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[9px] font-bold uppercase tracking-wide text-[var(--muted)]">
            {WEEKDAYS.map(day => (
              <div key={day} className="py-1">
                {day.slice(0, 1)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" role="group" aria-label="Calendar days">
            {days.map((iso, index) =>
              iso ? (
                <button
                  key={iso}
                  type="button"
                  data-date={iso}
                  data-testid={testId ? `${testId}-day-${iso}` : undefined}
                  aria-label={formatEnglishDate(iso)}
                  aria-pressed={iso === selected}
                  disabled={Boolean(min && iso < min)}
                  tabIndex={iso === activeIso ? 0 : -1}
                  onClick={() => choose(iso)}
                  onFocus={() => setActiveIso(iso)}
                  onKeyDown={onDayKeyDown}
                  className={`grid h-9 place-items-center rounded-lg text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    iso === selected
                      ? 'bg-[var(--orange)] text-white'
                      : iso === today
                        ? 'border border-[var(--orange)]/40 bg-[var(--orange-pale)] text-[var(--orange-deep)]'
                        : 'text-[var(--ink)] hover:bg-[var(--subtle-bg)]'
                  }`}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              ) : (
                <div key={`blank-${index}`} aria-hidden="true" />
              )
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2">
            <button
              type="button"
              data-testid={testId ? `${testId}-today` : undefined}
              onClick={() => choose(today)}
              disabled={Boolean(min && today < min)}
              className="min-h-[32px] rounded-lg px-2 text-[11px] font-bold text-[var(--orange-deep)] hover:bg-[var(--orange-pale)] disabled:opacity-40"
            >
              Today
            </button>
            <div className="flex gap-1">
              {value && (
                <button
                  type="button"
                  data-testid={testId ? `${testId}-clear` : undefined}
                  onClick={() => {
                    onChange('');
                    close();
                  }}
                  className="min-h-[32px] rounded-lg px-2 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                >
                  Clear date
                </button>
              )}
              <button
                type="button"
                data-testid={testId ? `${testId}-cancel` : undefined}
                onClick={() => close()}
                className="min-h-[32px] rounded-lg px-2 text-[11px] font-semibold text-[var(--muted)] hover:bg-[var(--subtle-bg)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
