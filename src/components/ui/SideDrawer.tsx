import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Called after the exit transition, once the drawer has unmounted. */
  onClosed?: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
  closeTestId?: string;
}

/**
 * Shared right-side drawer for product and order/customer details.
 *
 * It renders through a portal, locks background scrolling without a layout
 * jump, traps keyboard focus, closes on Escape/X/overlay, restores focus to the
 * trigger, and honours prefers-reduced-motion.
 */
export const SideDrawer: React.FC<SideDrawerProps> = ({
  open,
  onClose,
  onClosed,
  title,
  subtitle,
  children,
  footer,
  testId,
  closeTestId,
}) => {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const titleId = useId();

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (open) {
      if (!wasOpen.current) {
        restoreRef.current = document.activeElement as HTMLElement | null;
      }
      wasOpen.current = true;
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setShown(false);
    const timer = window.setTimeout(
      () => {
        setMounted(false);
        onClosedRef.current?.();
      },
      reduceMotion ? 0 : 220
    );
    return () => window.clearTimeout(timer);
  }, [open, reduceMotion]);

  useEffect(() => {
    if (!mounted) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const timer = window.setTimeout(
      () => closeRef.current?.focus({ preventScroll: true }),
      reduceMotion ? 0 : 30
    );
    return () => window.clearTimeout(timer);
  }, [mounted, reduceMotion]);

  useEffect(() => {
    if (!mounted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        element => element.offsetParent !== null
      );
      if (!nodes.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        nodes[0].focus({ preventScroll: true });
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mounted, onClose]);

  useEffect(() => {
    if (mounted) return;
    restoreRef.current?.focus?.({ preventScroll: true });
    restoreRef.current = null;
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <div
        aria-hidden="true"
        onClick={onClose}
        data-testid={testId ? `${testId}-overlay` : undefined}
        className={`absolute inset-0 bg-slate-950/30 ${
          reduceMotion ? '' : 'transition-opacity duration-200'
        } ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        data-state={shown ? 'open' : 'closed'}
        className={`absolute inset-y-0 right-0 flex h-full w-full flex-col bg-white shadow-2xl outline-none sm:w-[min(560px,92vw)] ${
          reduceMotion ? '' : 'transition-transform duration-200 ease-out'
        } ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-extrabold">
              {title}
            </h2>
            {subtitle && (
              <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid={closeTestId}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          data-testid={testId ? `${testId}-body` : undefined}
        >
          {children}
        </div>
        {footer && (
          <div className="border-t border-slate-200 px-4 py-3 sm:px-5">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
};
