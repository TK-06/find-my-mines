import { useId, useState } from 'react';

interface Props {
  /** "Hint", or "No hint" for a refusal. */
  label: string;
  /** What the hint (or the refusal) says. */
  text: string;
  failed?: boolean;
  /**
   * The explanation behind the hint. With it, a Why? button sits on the note
   * and opens it below; without it there is no button.
   */
  why?: string | null;
}

/**
 * The hint line: a ring in the hint's colour, the hint, and — when the server
 * (or, in Puzzle, this browser) worked out a reason — a Why? toggle that opens
 * it underneath. Closed to begin with. Key it by the hint, so each new hint
 * starts closed again.
 *
 * The toggle is a disclosure button (aria-expanded, aria-controls) rather than
 * part of the live region's wording, so a screen reader hears the hint when it
 * arrives and the reason only when asked for it.
 */
export function HintWithWhy({ label, text, failed = false, why = null }: Props) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <>
      <p className={`hint-note${failed ? ' failed' : ''}`}>
        <span className="hint-mark" aria-hidden="true" />
        <span>
          <strong>{label}</strong>
          {text ? ` · ${text}` : ''}
        </span>
        {why && (
          <button
            type="button"
            className="ghost small hint-why-toggle"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen((was) => !was)}
          >
            Why?
          </button>
        )}
      </p>
      {why && (
        <p id={panel} className="hint-why" hidden={!open}>
          {why}
        </p>
      )}
    </>
  );
}
