import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { SelectAllOnFocusInput } from './SelectAllOnFocusInput';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra text used for filtering, never displayed. */
  keywords?: string;
}

interface SearchableComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  emptyText?: string;
  testId?: string;
  disabled?: boolean;
  className?: string;
  /**
   * When true, ending a search without choosing an option clears the current
   * value instead of silently restoring it. Required where a previously saved
   * selection must not be submitted after the customer searched for another.
   */
  clearOnUnselectedQuery?: boolean;
}

/**
 * Accessible searchable single-select combobox. It supports pointer selection,
 * ArrowUp/ArrowDown/Enter/Escape, and filtering over the visible label plus
 * optional keywords (for example SKU code, product code, Chinese/English names).
 */
export const SearchableCombobox: React.FC<SearchableComboboxProps> = ({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder = 'Search…',
  emptyText = 'No matches',
  testId,
  disabled = false,
  className = '',
  clearOnUnselectedQuery = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find(option => option.value === value);
  const displayValue = dirty ? query : selected?.label ?? '';

  // The outside-pointer listener is registered once per open session, so keep
  // the latest editing state in a ref instead of a stale closure.
  const closeState = useRef({ dirty, onChange, clearOnUnselectedQuery });
  closeState.current = { dirty, onChange, clearOnUnselectedQuery };

  const closeSearch = () => {
    setOpen(false);
    if (closeState.current.clearOnUnselectedQuery && closeState.current.dirty) {
      closeState.current.onChange('');
    }
    setDirty(false);
    setQuery('');
  };

  const filtered = useMemo(() => {
    const needle = dirty ? query.trim().toLowerCase() : '';
    if (!needle) return options;
    return options.filter(option =>
      `${option.label} ${option.keywords ?? ''}`.toLowerCase().includes(needle)
    );
  }, [dirty, options, query]);

  const activeIndex = filtered.length ? Math.min(highlight, filtered.length - 1) : -1;

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeSearch();
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filtered.findIndex(option => option.value === value);
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    // Re-anchor only when the menu opens or the option set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options]);

  const choose = (option: ComboboxOption) => {
    onChange(option.value);
    setOpen(false);
    setDirty(false);
    setQuery('');
    inputRef.current?.focus();
  };

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    setDirty(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <SelectAllOnFocusInput
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          aria-disabled={disabled}
          data-testid={testId}
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          onFocus={openMenu}
          onClick={() => {
            if (!open) openMenu();
          }}
          onBlur={() => {
            closeSearch();
          }}
          onChange={event => {
            setDirty(true);
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) openMenu();
              setHighlight(index => Math.min(filtered.length - 1, index + 1));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) openMenu();
              setHighlight(index => Math.max(0, index - 1));
              return;
            }
            if (event.key === 'Escape') {
              closeSearch();
              return;
            }
            if (event.key === 'Enter' && open && activeIndex >= 0) {
              event.preventDefault();
              choose(filtered[activeIndex]);
            }
          }}
          className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-8 text-xs text-slate-900 outline-none focus:border-[#ff681e] focus:ring-2 focus:ring-[#ff681e]/25 disabled:bg-slate-100"
        />
        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500">{emptyText}</div>
          ) : (
            filtered.map((option, index) => (
              <button
                key={option.value}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-[11px] leading-relaxed ${
                  index === activeIndex ? 'bg-slate-100 text-slate-900' : 'text-slate-700'
                }`}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {option.value === value && (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
