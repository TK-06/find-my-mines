import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { lineShareUrl, roomLink, shareDetails } from '../data/share.js';

interface Props {
  roomId: string;
  roomName: string;
  /** A private room is not in the game list: the code and link are the only way in. */
  isPrivate: boolean;
}

/** What the last Copy did: nothing yet, copied, or selected the link for the player to copy. */
type CopyState = 'idle' | 'copied' | 'manual';

/**
 * The room bar's Share button: the room code in large type, its /join link,
 * and ways to send it — copy, LINE, or the phone's own share sheet.
 *
 * A small popover rather than a modal: Esc or a click outside closes it, and
 * tabbing out of it does too. Opening moves focus to Copy link; Esc hands
 * focus back to the button.
 */
export function ShareRoom({ roomId, roomName, isPrivate }: Props) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const titleId = useId();
  const linkId = useId();

  const link = roomLink(window.location.origin, roomId);
  // Phones and a few desktop browsers have a share sheet; elsewhere the
  // button would do nothing, so it is not shown.
  const canShareSheet = typeof navigator.share === 'function';

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setCopy('idle');
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    copyRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    // pointerdown, not click: a press that starts outside and ends inside is
    // still a click outside.
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  /**
   * Tabbing out closes it. Focus going nowhere (a click on plain text inside,
   * or the LINE tab opening) leaves it open.
   */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !wrapRef.current?.contains(next)) close(false);
  };

  async function copyLink() {
    try {
      // Missing outside a secure context — plain http on a LAN address.
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
      setCopy('copied');
    } catch {
      // Select the link instead, so Ctrl+C or a long-press copies it. The old
      // copy command still works in most browsers where the clipboard API
      // does not; if it fails too, the selection is there.
      const input = linkRef.current;
      input?.focus();
      input?.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      setCopy(copied ? 'copied' : 'manual');
    }
  }

  async function openShareSheet() {
    try {
      await navigator.share(shareDetails(roomName, roomId, link));
    } catch {
      // Dismissed, or the browser refused: nothing to undo.
    }
  }

  return (
    <div className="share" ref={wrapRef} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        Share
      </button>

      {open && (
        <div id={panelId} className="share-pop card" role="dialog" aria-labelledby={titleId}>
          <h3 id={titleId} className="share-title">
            Invite people to this room
          </h3>

          <p className="field-label">Room code</p>
          <p className="share-code">{roomId}</p>

          <label className="field-label" htmlFor={linkId}>
            Link
          </label>
          <input
            ref={linkRef}
            id={linkId}
            className="share-link"
            type="text"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
          />

          <p className="muted share-note">
            {isPrivate
              ? 'This room is private: only people with the code or link can find it.'
              : 'Anyone with the link lands straight in this room.'}
          </p>

          <div className="share-actions">
            <button ref={copyRef} type="button" onClick={() => void copyLink()}>
              {copy === 'copied' ? 'Copied' : 'Copy link'}
            </button>
            <a
              className="share-line"
              href={lineShareUrl(link)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on LINE
            </a>
            {canShareSheet && (
              <button type="button" className="ghost" onClick={() => void openShareSheet()}>
                Other apps…
              </button>
            )}
          </div>

          <p className="share-status" role="status">
            {copy === 'copied'
              ? 'Link copied.'
              : copy === 'manual'
                ? 'The link is selected — press Ctrl+C, or long-press to copy.'
                : ''}
          </p>
        </div>
      )}
    </div>
  );
}
