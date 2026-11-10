import React from 'react';
import { CalendarDays, LogOut, Menu } from 'lucide-react';
import type { AuthUserDto } from '../auth/api';
import type { OrderLanguage } from '../utils/orderStatus';
import { formatEnglishDate } from '../utils/dateDisplay';
import { LanguageToggle } from '../components/ui/LanguageToggle';

interface RealTopbarProps {
  user: AuthUserDto;
  title: string;
  language: OrderLanguage;
  onLanguageChange: (language: OrderLanguage) => void;
  onSignOut: () => void | Promise<void>;
  onOpenNavigation: () => void;
  navigationOpen: boolean;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
}

export const RealTopbar: React.FC<RealTopbarProps> = ({
  user,
  title,
  language,
  onLanguageChange,
  onSignOut,
  onOpenNavigation,
  navigationOpen,
  menuButtonRef,
}) => {
  const today = formatEnglishDate(new Date().toISOString());

  return (
    <header className="sticky top-0 z-30 flex h-[74px] shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-white px-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenNavigation}
          data-testid="internal-nav-open"
          aria-label={language === 'zh' ? '打开导航' : 'Open navigation'}
          aria-expanded={navigationOpen}
          aria-controls="real-sidebar"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] bg-white text-[#4f5150] hover:bg-[var(--subtle-bg)] lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted)]">
          <span className="hidden font-medium sm:inline">AOKING Direct</span>
          <span className="hidden text-[#c0c0c0] sm:inline">/</span>
          <strong
            data-testid="internal-page-title"
            className="truncate text-xs font-bold text-[var(--ink)]"
          >
            {title}
          </strong>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div
          data-testid="internal-date"
          className="hidden items-center gap-1.5 text-[11px] text-[var(--muted)] xl:flex"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {today}
        </div>

        <LanguageToggle
          value={language}
          onChange={onLanguageChange}
          label={language === 'zh' ? '内部界面语言' : 'Internal language'}
          testId="internal-language-toggle"
        />

        <div
          data-testid="real-user-meta"
          className="max-w-[92px] text-right text-[11px] leading-tight sm:max-w-[170px]"
        >
          <div className="truncate font-semibold">{user.displayName}</div>
          <div className="hidden truncate font-mono text-[var(--muted)] sm:block">
            {user.username}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void onSignOut()}
          aria-label="Sign out"
          className="fo-btn flex min-h-[40px] items-center gap-2"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">{language === 'zh' ? '退出' : 'Sign out'}</span>
        </button>
      </div>
    </header>
  );
};
