import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

interface HelpTooltipProps {
  /** Short accessible name for the help button. */
  label: string;
  children: React.ReactNode;
  align?: 'left' | 'right';
  testId?: string;
  className?: string;
}

/**
 * A small, reusable "?" disclosure for secondary customer guidance. It opens on
 * hover, keyboard focus and click; Escape and an outside press close it. The
 * content remains reachable without hover (touch/keyboard), and the panel is
 * capped to the viewport so it cannot introduce horizontal overflow.
 */
export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  label,
  children,
  align = 'left',
  testId,
  className = '',
}) => {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const suppressNextFocus = useRef(false);
  const tooltipId = useId();
  const open = pinned || hovered || focused;

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setHovered(false);
        setFocused(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPinned(false);
      setHovered(false);
      setFocused(false);
      suppressNextFocus.current = true;
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} help`}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        data-testid={testId ? `${testId}-button` : undefined}
        onClick={event => {
          event.stopPropagation();
          const next = !pinned;
          setPinned(next);
          if (!next) {
            // A second click should close even while the pointer still hovers.
            setHovered(false);
            setFocused(false);
          }
        }}
        onFocus={() => {
          if (suppressNextFocus.current) {
            suppressNextFocus.current = false;
          } else {
            setFocused(true);
          }
        }}
        onBlur={() => setFocused(false)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition-colors hover:border-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          data-testid={testId}
          onClick={event => event.stopPropagation()}
          className={`absolute top-full z-[80] mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-normal leading-relaxed text-slate-600 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <span className="flex items-start gap-2">
            <span className="flex-1">{children}</span>
            <button
              type="button"
              aria-label="Close help"
              onClick={event => {
                event.stopPropagation();
                setPinned(false);
                setHovered(false);
                setFocused(false);
                suppressNextFocus.current = true;
                buttonRef.current?.focus();
              }}
              className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        </span>
      )}
    </span>
  );
};
