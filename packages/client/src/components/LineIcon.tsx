import type { ReactNode } from 'react';

/**
 * A stroked 24×24 icon that takes the colour of the text beside it.
 *
 * Always decorative: every icon here sits next to a visible label, so it is
 * hidden from screen readers rather than announced twice.
 */
export function LineIcon({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
