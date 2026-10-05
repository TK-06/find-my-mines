/**
 * The review icon: a small grid with a magnifier over its corner, drawn in
 * strokes that take the colour of the text around them. Decorative: the button
 * or link that holds it carries the words.
 */
export function ReviewIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <path d="M7 3v12M11 3v12M3 7h12M3 11h12" />
      <circle cx="16" cy="16" r="4.2" />
      <path d="M19.2 19.2 21.5 21.5" />
    </svg>
  );
}
