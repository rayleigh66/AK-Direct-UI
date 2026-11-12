import React, { useEffect, useRef } from 'react';
import { SelectAllOnFocusInput } from './SelectAllOnFocusInput';

interface QuantityFieldProps {
  value: string | number;
  min: number;
  max?: number;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  testId?: string;
  className?: string;
  disabled?: boolean;
  selectAllOnFirstFocus?: boolean;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

const clamp = (value: number, min: number, max: number | undefined) => {
  if (!Number.isFinite(value)) return min;
  const upper = max === undefined ? Number.MAX_SAFE_INTEGER : Math.max(min, max);
  return Math.min(upper, Math.max(min, Math.round(value)));
};

/**
 * Quantity input shared by the customer surfaces. It selects all whenever it is
 * entered from a blurred state, keeps normal editing on repeated clicks, and
 * turns a damped wheel motion over the numeric field into single-step changes.
 * The wheel listener is scoped to the field, so the rest of the page scrolls
 * normally.
 */
export const QuantityField: React.FC<QuantityFieldProps> = ({
  value,
  min,
  max,
  onValueChange,
  ariaLabel,
  testId,
  className = '',
  disabled = false,
  selectAllOnFirstFocus = true,
  onBlur,
  onKeyDown,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const currentValue = useRef(value);
  const currentMin = useRef(min);
  const currentMax = useRef(max);
  const changeRef = useRef(onValueChange);

  useEffect(() => {
    currentValue.current = value;
  }, [value]);
  useEffect(() => {
    currentMin.current = min;
  }, [min]);
  useEffect(() => {
    currentMax.current = max;
  }, [max]);
  useEffect(() => {
    changeRef.current = onValueChange;
  }, [onValueChange]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || disabled) return;

    let accumulated = 0;
    let lastStepAt = 0;

    const handleWheel = (event: WheelEvent) => {
      // The listener is attached to the input itself, so a wheel gesture only
      // steps the quantity while the pointer is over the numeric field. Moving
      // the pointer away lets the page scroll normally.
      if (event.deltaY === 0) return;
      event.preventDefault();

      accumulated += event.deltaY;
      const now = performance.now();
      // The accumulator is the damping: small trackpad deltas must build up
      // before a whole PCS step, and steps are rate-limited.
      if (Math.abs(accumulated) < 30 || now - lastStepAt < 90) return;

      const direction = accumulated > 0 ? 1 : -1;
      accumulated = 0;
      lastStepAt = now;
      const next = clamp(
        Number(currentValue.current) + direction,
        currentMin.current,
        currentMax.current
      );
      changeRef.current(String(next));
    };

    input.addEventListener('wheel', handleWheel, { passive: false });
    return () => input.removeEventListener('wheel', handleWheel);
  }, [disabled]);

  return (
    <SelectAllOnFocusInput
      ref={inputRef}
      type="number"
      inputMode="numeric"
      step={1}
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      selectAllOnFirstFocus={selectAllOnFirstFocus}
      onChange={event => onValueChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={className}
    />
  );
};
