import { CHAT_MAX_LENGTH, type ChatMessage, type ModerationResult } from '@fmm/shared';
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { canSendChat, formatClock, groupMessages, isNearBottom, isoTime } from '../data/chat.js';
import { initialOf } from '../data/friendsModel.js';

interface Props {
  messages: ChatMessage[];
  connected: boolean;
  onSay: (text: string) => Promise<ModerationResult>;
}

/**
 * The computer's avatar: a small pixel robot, in the same 8-bit spirit as the
 * mine, so it never passes for a person's initial.
 */
const ROBOT = (
  <svg viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M4 0h1v2h-1zM1 2h7v2h-7zM0 4h3v1h-3zM4 4h1v1h-1zM6 4h3v1h-3zM1 5h7v1h-7zM1 6h2v1h-2zM6 6h2v1h-2zM1 7h7v1h-7z"
    />
  </svg>
);

/**
 * The room's chat, for players and spectators alike, laid out like Discord:
 * one avatar, name and time per run of lines from the same sender.
 *
 * The server keeps no history, so this shows what arrived since joining. A
 * line appears when the server sends it back — including your own — so what
 * you see is what everyone in the room saw. Text is rendered as text (React
 * escapes it); nothing a player types is ever treated as markup.
 */
export function RoomChat({ messages, connected, onSay }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** New lines arrived while the reader was scrolled up. */
  const [unseen, setUnseen] = useState(false);

  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Follow new lines unless the reader has scrolled up to older ones. */
  const following = useRef(true);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  // Layout effect: scrolled before the browser paints, so a new line never
  // flashes in above the fold first.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    if (following.current) el.scrollTop = el.scrollHeight;
    else if (messages.length > 0) setUnseen(true);
  }, [messages]);

  function jumpToNewest() {
    const el = log.current;
    following.current = true;
    setUnseen(false);
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending || !canSendChat(draft)) return;
    setSending(true);
    const result = await onSay(draft);
    setSending(false);
    if (result.ok) {
      setDraft('');
      setError(null);
      // Your own line is the one you want to see land.
      following.current = true;
      // Send is disabled again once the box is empty; keep typing where you were.
      input.current?.focus();
    } else {
      setError(result.error ?? 'Your message was not sent.');
    }
  }

  return (
    <section className="card room-chat" aria-labelledby="room-chat-title">
      <h3 id="room-chat-title">Room chat</h3>

      <div
        ref={log}
        className="chat-log"
        role="log"
        aria-live="polite"
        aria-labelledby="room-chat-title"
        // Scrollable, so it must be reachable by keyboard too.
        tabIndex={0}
        onScroll={(event) => {
          following.current = isNearBottom(event.currentTarget);
          if (following.current) setUnseen(false);
        }}
      >
        {groups.length === 0 ? (
          <p className="chat-empty muted">No messages yet. Say hi.</p>
        ) : (
          groups.map((group) => {
            const bot = group.kind === 'bot';
            return (
              <div key={group.key} className="chat-group">
                <span className={`chat-avatar${bot ? ' bot' : ''}`} aria-hidden="true">
                  {bot ? ROBOT : initialOf(group.fromName)}
                </span>
                <div className="chat-body">
                  <div className="chat-meta">
                    <strong className="chat-name">{group.fromName}</strong>
                    {bot && <span className="tag bot">bot</span>}
                    <time className="chat-time" dateTime={isoTime(group.at)}>
                      {formatClock(group.at)}
                    </time>
                  </div>
                  {group.messages.map((message, index) => (
                    <p key={message.id} className="chat-text">
                      {/* A line added under an existing header is announced on
                          its own; say who it is from. */}
                      {index > 0 && <span className="chat-sr">{group.fromName}: </span>}
                      {message.text}
                    </p>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {unseen && (
        <button type="button" className="ghost small chat-jump" onClick={jumpToNewest}>
          New messages — jump to newest
        </button>
      )}

      <form className="chat-form" onSubmit={(event) => void submit(event)}>
        <input
          ref={input}
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          placeholder="Message the room…"
          aria-label="Message the room"
          maxLength={CHAT_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" disabled={!connected || sending || !canSendChat(draft)}>
          Send
        </button>
      </form>

      {error && (
        <p className="form-error chat-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
