import React, { forwardRef, useImperativeHandle, useRef } from 'react';

export interface SelectAllOnFocusInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Select the current value the first time this input receives focus. It does
   * not re-select on later clicks, so cursor placement, copy/paste, keyboard
   * editing and touch selection continue to behave normally.
   */
  selectAllOnFirstFocus?: boolean;
}

export const SelectAllOnFocusInput = forwardRef<
  HTMLInputElement,
  SelectAllOnFocusInputProps
>(function SelectAllOnFocusInput(
  { selectAllOnFirstFocus = true, onFocus, onMouseUp, onPointerDown, ...props },
  forwardedRef
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedOnce = useRef(false);
  const pointerDown = useRef(false);
  const pendingMouseSelect = useRef(false);

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);

  const selectAll = (input: HTMLInputElement) => {
    if (!input.value) return;
    input.select();
  };

  return (
    <input
      {...props}
      ref={inputRef}
      onPointerDown={event => {
        pointerDown.current = true;
        onPointerDown?.(event);
      }}
      onFocus={event => {
        if (selectAllOnFirstFocus && !focusedOnce.current) {
          focusedOnce.current = true;
          // A pointer focus is followed by mouseup, which would collapse the
          // selection. Prevent that once; keyboard focus keeps the selection.
          pendingMouseSelect.current = pointerDown.current;
          pointerDown.current = false;
          selectAll(event.currentTarget);
        }
        onFocus?.(event);
      }}
      onMouseUp={event => {
        if (pendingMouseSelect.current) {
          pendingMouseSelect.current = false;
          event.preventDefault();
          selectAll(event.currentTarget);
        }
        onMouseUp?.(event);
      }}
    />
  );
});
