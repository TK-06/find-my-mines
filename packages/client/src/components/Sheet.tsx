import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  /** Extra class on the sheet, for its own layout. */
  className?: string;
  /** Shown beside the title, before the close button (tabs, a count). */
  headExtra?: ReactNode;
  children: ReactNode;
}

/**
 * A panel that comes up from the bottom of a phone screen over a dimmed page,
 * like the player card does: what the one-line summaries open into (who is
 * online, the chat, your friends). On a wide screen the same sheet stands in
 * the bottom-right corner as a floating panel.
 *
 * Escape, the × and a tap on the dimmed page all close it, and focus goes back
 * to whatever opened it. No transform is used for its entrance: a transformed
 * parent would trap a player card opened from inside it.
 */
export function Sheet({ title, onClose, className, headExtra, children }: Props) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A player card or dialog opened from inside handles its own Escape first.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.player-card, .overlay')) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // Set up once per opening. onClose is a fresh arrow each render but always
    // does the same thing, so the first one is fine to keep.
  }, []);

  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheetRef}
        className={`sheet card${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          {headExtra}
          <button type="button" className="dialog-close sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
