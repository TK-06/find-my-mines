import {
  CHAT_MAX_LENGTH,
  type LobbyMessage,
  type ModerationResult,
  type RoomSummary,
} from '@fmm/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { canSendChat, formatClock, groupMessages, isNearBottom, isoTime } from '../data/chat.js';
import { inviteAvailability } from '../data/worldChat.js';
import { Avatar } from './Avatar.js';

interface Props {
  messages: LobbyMessage[];
  /** The live game list, so an invite card knows whether its room still has a seat. */
  rooms: RoomSummary[];
  connected: boolean;
  myId: string | null;
  onSay: (text: string) => Promise<ModerationResult>;
  /** The lobby's own join: asks first where the room requires it. */
  onJoin: (roomId: string) => void;
}

/**
 * The lobby's world chat: everyone who has picked a name, guests included,
 * laid out like the room chat — one avatar, name and time per run of lines.
 *
 * The server keeps the last few dozen lines in memory and sends them on
 * arrival; nothing is saved anywhere. A line appears when the server sends it
 * back, your own included. Text is rendered as text (React escapes it), so
 * nothing anyone types is ever treated as markup.
 */
export function WorldChat({ messages, rooms, connected, myId, onSay, onJoin }: Props) {
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
      input.current?.focus();
    } else {
      setError(result.error ?? 'Your message was not sent.');
    }
  }

  return (
    <section className="card world-chat" aria-labelledby="world-chat-title">
      <div className="world-chat-head">
        <h3 id="world-chat-title">World chat</h3>
        <p className="muted">Everyone in the lobby sees this. Nothing is saved.</p>
      </div>

      <div
        ref={log}
        className="chat-log"
        role="log"
        aria-live="polite"
        aria-labelledby="world-chat-title"
        // Scrollable, so it must be reachable by keyboard too.
        tabIndex={0}
        onScroll={(event) => {
          following.current = isNearBottom(event.currentTarget);
          if (following.current) setUnseen(false);
        }}
      >
        {groups.length === 0 ? (
          <p className="chat-empty muted">Nobody has said anything yet. Say hi.</p>
        ) : (
          groups.map((group) => {
            const first = group.messages[0]!;
            return (
              <div key={group.key} className="chat-group">
                <Avatar name={group.fromName} url={first.fromAvatarUrl} size={32} />
                <div className="chat-body">
                  <div className="chat-meta">
                    <strong className="chat-name">{group.fromName}</strong>
                    {group.fromId === myId && <span className="tag me">you</span>}
                    {first.isGuest && <span className="tag">guest</span>}
                    <time className="chat-time" dateTime={isoTime(group.at)}>
                      {formatClock(group.at)}
                    </time>
                  </div>
                  {group.messages.map((message, index) =>
                    message.kind === 'invite' && message.invite ? (
                      <InviteCard
                        key={message.id}
                        message={message}
                        rooms={rooms}
                        connected={connected}
                        onJoin={onJoin}
                      />
                    ) : (
                      <p key={message.id} className="chat-text">
                        {/* A line added under an existing header is announced on
                            its own; say who it is from. */}
                        {index > 0 && <span className="chat-sr">{group.fromName}: </span>}
                        {message.text}
                      </p>
                    ),
                  )}
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
          placeholder="Message everyone…"
          aria-label="Message the world chat"
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

/**
 * A room someone advertised. The numbers and the button follow the live game
 * list, so a card posted a while ago never offers a seat that has gone.
 */
function InviteCard({
  message,
  rooms,
  connected,
  onJoin,
}: {
  message: LobbyMessage;
  rooms: RoomSummary[];
  connected: boolean;
  onJoin: (roomId: string) => void;
}) {
  const invite = message.invite!;
  const live = inviteAvailability(invite, rooms);
  return (
    <div className="invite-card">
      <p className="chat-text">{message.text}</p>
      <div className="invite-card-room">
        <div className="invite-card-info">
          <div className="invite-card-title">
            <strong>{invite.roomName}</strong>
            <span className="room-code">{invite.roomId}</span>
          </div>
          <p className="muted invite-card-meta">
            {invite.rows}×{invite.cols} · {invite.mineCount} mines · {live.playerCount}/
            {live.maxPlayers ?? '∞'} players
          </p>
          <div className="invite-card-tags">
            <span className={`tag mode-${invite.mode}`}>{invite.mode}</span>
            {invite.joinByRequest && <span className="tag">ask to join</span>}
            {invite.private && <span className="tag private-tag">private</span>}
          </div>
        </div>
        <button
          type="button"
          className="small invite-join"
          disabled={!connected || !live.canJoin}
          onClick={() => onJoin(invite.roomId)}
        >
          {live.label}
          <span className="chat-sr"> — {invite.roomName}</span>
        </button>
      </div>
    </div>
  );
}

/** How long the room bar says whether the invite went out. */
const NOTE_MS = 4000;

/**
 * The room bar's "Post invite to world chat". The server decides whether you
 * may; this only shows its answer for a few seconds.
 */
export function PostInviteButton({
  connected,
  onPost,
}: {
  connected: boolean;
  onPost: () => Promise<ModerationResult>;
}) {
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The answer may land after the room bar is gone (left the room meanwhile). */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function post() {
    if (posting) return;
    setPosting(true);
    const result = await onPost();
    if (!mounted.current) return;
    setPosting(false);
    setNote(
      result.ok
        ? { ok: true, text: 'Invite posted to the world chat.' }
        : { ok: false, text: result.error ?? 'The invite was not posted.' },
    );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), NOTE_MS);
  }

  return (
    <span className="post-invite">
      <button type="button" className="ghost" disabled={!connected || posting} onClick={() => void post()}>
        {posting ? 'Posting…' : 'Post invite to world chat'}
      </button>
      {/* Always present, so screen readers announce the answer when it appears. */}
      <span className={`post-invite-note${note ? (note.ok ? ' ok' : ' bad') : ''}`} role="status">
        {note?.text}
      </span>
    </span>
  );
}
