import React, { forwardRef, useImperativeHandle, useRef } from 'react';

export interface SelectAllOnFocusInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Select the current value every time the input is entered from a blurred
   * state. Repeated clicks while it remains focused keep normal caret
   * placement, so copy/paste, keyboard editing and touch selection continue to
   * behave normally.
   */
  selectAllOnFirstFocus?: boolean;
}

export const SelectAllOnFocusInput = forwardRef<
  HTMLInputElement,
  SelectAllOnFocusInputProps
>(function SelectAllOnFocusInput(
  {
    selectAllOnFirstFocus = true,
    onFocus,
    onBlur,
    onMouseUp,
    onPointerDown,
    onPointerUp,
    ...props
  },
  forwardedRef
) {
  const inputRef = useRef<HTMLInputElement>(null);
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
      onPointerUp={event => {
        // A pointer press that started while the input was already focused did
        // not produce a new focus event; do not let that stale flag affect the
        // next focus session.
        pointerDown.current = false;
        onPointerUp?.(event);
      }}
      onFocus={event => {
        if (selectAllOnFirstFocus) {
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
      onBlur={event => {
        // The next focus starts a new editing session and should select all
        // again; clear one-shot pointer state so it cannot leak across blurs.
        pointerDown.current = false;
        pendingMouseSelect.current = false;
        onBlur?.(event);
      }}
    />
  );
});
