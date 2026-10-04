import { useEffect, useRef, useState } from 'react';

/** What the last press did: nothing yet, copied, or left the text selected for the player to copy. */
type CopyState = 'idle' | 'copied' | 'manual';

/** How long the button says "Copied" before it says "Share" again, in milliseconds. */
const COPIED_MS = 2000;

/**
 * The Daily's Share button: copies the one-line result. Where the clipboard is
 * not available (plain http on a LAN address, a browser that refuses) a text box
 * with the line appears, already selected, so Ctrl+C or a long-press copies it
 * by hand. Phones and a few desktop browsers also get their own share sheet,
 * as the room's Share popover does.
 */
export function DailyShare({ text }: { text: string }) {
  const [copy, setCopy] = useState<CopyState>('idle');
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // Elsewhere the button would do nothing, so it is not shown.
  const canShareSheet = typeof navigator.share === 'function';

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // A different result (another day, another game) starts from a clean button.
  useEffect(() => {
    window.clearTimeout(timer.current);
    setCopy('idle');
  }, [text]);

  // The box only exists once copying failed; select it as it appears.
  useEffect(() => {
    if (copy !== 'manual') return;
    boxRef.current?.focus();
    boxRef.current?.select();
  }, [copy]);

  async function copyResult() {
    window.clearTimeout(timer.current);
    try {
      // Missing outside a secure context.
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopy('copied');
      timer.current = window.setTimeout(() => setCopy('idle'), COPIED_MS);
    } catch {
      setCopy('manual');
    }
  }

  async function openShareSheet() {
    try {
      await navigator.share({ title: 'Find My Mines', text });
    } catch {
      // Dismissed, or the browser refused: nothing to undo.
    }
  }

  return (
    <div className="puzzle-share">
      <div className="puzzle-share-actions">
        <button type="button" onClick={() => void copyResult()}>
          {copy === 'copied' ? 'Copied' : 'Share'}
        </button>
        {canShareSheet && (
          <button type="button" className="ghost" onClick={() => void openShareSheet()}>
            Other apps…
          </button>
        )}
      </div>

      {copy === 'manual' && (
        <textarea
          ref={boxRef}
          className="puzzle-share-box"
          readOnly
          rows={2}
          value={text}
          aria-label="Your Daily result, to copy"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}

      <p className="share-status" role="status">
        {copy === 'copied'
          ? 'Result copied — paste it anywhere.'
          : copy === 'manual'
            ? 'It could not be copied automatically. The result is selected: press Ctrl+C, or long-press to copy.'
            : ''}
      </p>
    </div>
  );
}
