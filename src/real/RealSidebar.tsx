import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { BrandLockup } from '../components/BrandLockup';

export interface RealSidebarItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

export interface RealSidebarGroup {
  label: string;
  items: RealSidebarItem[];
}

interface RealSidebarProps {
  groups: RealSidebarGroup[];
  activeKey: string;
  open: boolean;
  language: 'en' | 'zh';
  onSelect: (key: string) => void;
  onClose: () => void;
}

export const RealSidebar: React.FC<RealSidebarProps> = ({
  groups,
  activeKey,
  open,
  language,
  onSelect,
  onClose,
}) => {
  const firstLinkRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstLinkRef.current?.focus();
  }, [open]);

  return (
    <>
      {open && (
        <div
          data-testid="real-sidebar-backdrop"
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        id="real-sidebar"
        data-testid="real-sidebar"
        aria-label={language === 'zh' ? '内部导航' : 'Internal navigation'}
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-[var(--line)] bg-white transition-transform duration-200 motion-reduce:transition-none ${
          open
            ? 'translate-x-0 visible'
            : '-translate-x-full invisible lg:visible lg:translate-x-0'
        }`}
      >
        <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-[var(--line)] px-5">
          <BrandLockup size="sm" testId="brand-lockup-sidebar" />
          <button
            type="button"
            onClick={onClose}
            data-testid="internal-nav-close"
            aria-label={language === 'zh' ? '关闭导航' : 'Close navigation'}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)] lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav
          aria-label={language === 'zh' ? '内部导航菜单' : 'Internal navigation menu'}
          className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-5"
        >
          {groups.map(group => (
            <div key={group.label} className="space-y-1">
              <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[1.7px] text-[#a3a4a4]">
                {group.label}
              </div>
              {group.items.map(item => {
                const active = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    ref={item.key === groups[0]?.items[0]?.key ? firstLinkRef : undefined}
                    type="button"
                    onClick={() => onSelect(item.key)}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`real-tab-${item.key}`}
                    className={`flex min-h-[42px] w-full items-center gap-3 rounded-[10px] px-3.5 text-left text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-[var(--nav-active-bg)] text-white shadow-sm'
                        : 'text-[#696b6c] hover:bg-[var(--subtle-bg)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <span className={active ? 'text-[var(--orange)]' : 'text-[#8a8c8c]'}>
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
};
