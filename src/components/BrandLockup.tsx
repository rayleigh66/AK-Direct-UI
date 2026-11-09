import React from 'react';

type BrandSize = 'sm' | 'md' | 'lg';

const MARK_SIZE: Record<BrandSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9 sm:h-10 sm:w-10',
  lg: 'h-11 w-11 sm:h-12 sm:w-12',
};

const TEXT_SIZE: Record<BrandSize, string> = {
  sm: 'text-[18px]',
  md: 'text-[19px] sm:text-[23px]',
  lg: 'text-[24px] sm:text-[28px]',
};

const GAP: Record<BrandSize, string> = {
  sm: 'gap-2',
  md: 'gap-2 sm:gap-2.5',
  lg: 'gap-3',
};

/**
 * The single AOKING Direct lockup used by customer, internal and login
 * surfaces. The mark is a black rounded tile with the white rotated-square
 * outline and the orange lower-right accent; the wordmark stays tight with
 * AOKING in ink and Direct in brand orange.
 */
export const BrandLockup: React.FC<{
  size?: BrandSize;
  testId?: string;
  className?: string;
}> = ({ size = 'md', testId, className = '' }) => (
  <div
    data-testid={testId}
    className={`flex shrink-0 items-center ${GAP[size]} ${className}`}
  >
    <svg
      viewBox="0 0 48 48"
      className={`${MARK_SIZE[size]} shrink-0`}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="48" height="48" rx="12" fill="#151515" />
      <rect
        x="13.5"
        y="13"
        width="21"
        height="21"
        rx="5"
        transform="rotate(45 24 23.5)"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.6"
      />
      <rect x="29.5" y="29.5" width="12.5" height="12.5" rx="3.2" fill="#FF681E" />
    </svg>
    <span
      className={`whitespace-nowrap font-black leading-none tracking-[-0.055em] ${TEXT_SIZE[size]}`}
    >
      <span className="text-[#151515]">AOKING</span>
      <span className="text-[#FF681E]">Direct</span>
    </span>
  </div>
);
