import type { OnlinePlayer } from '@fmm/shared';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FriendAction, FriendRow, Friendship } from '../data/friendsModel.js';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_CHARS,
  normalizeQuery,
  presenceText,
  rankResults,
  searchProfiles,
  type FoundProfile,
  type SearchResult,
} from '../data/playerSearch.js';
import { Avatar } from './Avatar.js';

export interface FriendSearchProps {
  userId: string;
  friendships: Friendship[];
  online: OnlinePlayer[];
  /** Each friend's row as the list draws it, for their live button (Invite / Join / Watch). */
  friendRows: ReadonlyMap<string, FriendRow>;
  /** People with a change in flight. */
  busy: ReadonlySet<string>;
  /** "Invited", or why not, per friend. */
  inviteNotes: ReadonlyMap<string, { text: string; failed: boolean }>;
  /** Sends a request. Resolves true when it went through, and the box empties. */
  onAdd: (result: SearchResult) => Promise<boolean>;
  /** They asked first: says yes. */
  onAccept: (result: SearchResult) => Promise<boolean>;
  onFriendAction: (row: FriendRow, action: FriendAction) => void;
  onClose: () => void;
}

type Search =
  | { status: 'idle' | 'loading'; found: FoundProfile[]; query: string }
  | { status: 'done'; found: FoundProfile[]; query: string }
  | { status: 'error'; found: FoundProfile[]; query: string; error: string };

/**
 * Find a player by typing part of their username: a dropdown of matches with
 * friends first, the letters typed highlighted, and each row's one action —
 * Add, Accept, or a friend's live Invite / Join / Watch. Arrow keys move, Enter
 * does the highlighted row's action, Esc clears and then closes.
 */
export function FriendSearch({
  userId,
  friendships,
  online,
  friendRows,
  busy,
  inviteNotes,
  onAdd,
  onAccept,
  onFriendAction,
  onClose,
}: FriendSearchProps) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ status: 'idle', found: [], query: '' });
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;

  // Re-run when the friends list changes too: a request just sent becomes "requested".
  const friendIds = useMemo(() => friendships.map((f) => f.otherId), [friendships]);
  const clean = normalizeQuery(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    if (clean.length < SEARCH_MIN_CHARS) {
      setSearch({ status: 'idle', found: [], query: clean });
      return;
    }
    setSearch((current) => ({ ...current, status: 'loading' }) as Search);
    const timer = setTimeout(() => {
      void searchProfiles(clean, friendIds).then((outcome) => {
        // A newer keystroke has its own search out: this answer is stale.
        if (mine !== seq.current) return;
        setSearch(
          outcome.ok
            ? { status: 'done', found: outcome.found, query: clean }
            : { status: 'error', found: [], query: clean, error: outcome.error },
        );
        setActive(0);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [clean, friendIds]);

  const results = useMemo(
    () => rankResults(search.found, search.query, { myId: userId, friendships, online }),
    [search, userId, friendships, online],
  );
  const showList = clean.length >= SEARCH_MIN_CHARS;
  const current = results[Math.min(active, results.length - 1)];

  async function perform(result: SearchResult) {
    if (busy.has(result.id)) return;
    if (result.relation === 'none') {
      if (await onAdd(result)) setQuery('');
    } else if (result.relation === 'incoming') {
      if (await onAccept(result)) setQuery('');
    } else if (result.relation === 'friend') {
      const row = friendRows.get(result.id);
      if (row?.action) onFriendAction(row, row.action);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (current) void perform(current);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query) setQuery('');
      else onClose();
    }
  }

  return (
    <div className="friend-search">
      <label htmlFor={inputId} className="field-label">
        Find a player
      </label>
      <div className="friend-search-field">
        <SearchIcon />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && current ? optionId(baseId, current.id) : undefined}
          value={query}
          maxLength={20}
          placeholder="Type part of a username"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {search.status === 'done' && showList && (
          <span className="search-count" aria-hidden>
            {results.length} found
          </span>
        )}
      </div>

      {showList && (
        <div className="search-results">
          {results.length > 0 ? (
            <ul id={listId} role="listbox" aria-label={`Players matching ${clean}`} className="search-list">
              {results.map((result, index) => (
                <ResultRow
                  key={result.id}
                  id={optionId(baseId, result.id)}
                  result={result}
                  query={search.query}
                  active={index === active}
                  busy={busy.has(result.id)}
                  friendRow={friendRows.get(result.id)}
                  note={inviteNotes.get(result.id)}
                  onHover={() => setActive(index)}
                  onAct={() => void perform(result)}
                />
              ))}
            </ul>
          ) : (
            // An empty listbox still needs to exist for aria-controls.
            <ul id={listId} role="listbox" aria-label={`Players matching ${clean}`} className="search-list" />
          )}

          <p className="search-state" role="status">
            {search.status === 'loading' && results.length === 0
              ? 'Searching…'
              : search.status === 'error'
                ? search.error
                : search.status === 'done' && results.length === 0
                  ? `No player called “${clean}”. Usernames are 2–20 characters — check the spelling with them.`
                  : ''}
          </p>

          {results.length > 0 && (
            <div className="search-foot" aria-hidden>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> move
              </span>
              <span>
                <kbd>Enter</kbd> act
              </span>
              <span>
                <kbd>Esc</kbd> close
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function optionId(base: string, profileId: string): string {
  return `${base}-opt-${profileId}`;
}

function ResultRow({
  id,
  result,
  query,
  active,
  busy,
  friendRow,
  note,
  onHover,
  onAct,
}: {
  id: string;
  result: SearchResult;
  query: string;
  active: boolean;
  busy: boolean;
  friendRow: FriendRow | undefined;
  note: { text: string; failed: boolean } | undefined;
  onHover: () => void;
  onAct: () => void;
}) {
  const dot = result.presence === 'offline' ? 'offline' : result.presence === 'playing' ? 'playing' : 'online';
  const where = presenceText(result.presence);
  const elo = result.elo.toLocaleString('en-US');

  let action: ReactNode;
  let hint: string;
  // The buttons are for the mouse; the keyboard acts on the highlighted row
  // with Enter, so they stay out of the Tab order.
  const button = (label: string, primary: boolean) => (
    <button
      type="button"
      tabIndex={-1}
      className={`small${primary ? '' : ' ghost'}`}
      disabled={busy}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onAct}
    >
      {label}
    </button>
  );
  switch (result.relation) {
    case 'none':
      action = button(busy ? 'Sending…' : 'Add', active);
      hint = 'Enter sends a friend request.';
      break;
    case 'incoming':
      action = button('Accept', true);
      hint = 'They asked you — Enter accepts.';
      break;
    case 'outgoing':
      action = <span className="tag">requested</span>;
      hint = 'Request sent, waiting for them.';
      break;
    default:
      if (note) {
        action = <span className={`friend-note${note.failed ? ' failed' : ''}`}>{note.text}</span>;
        hint = note.text;
      } else if (friendRow?.action) {
        action = button(friendRow.action.label, active);
        hint = `Your friend — Enter: ${friendRow.action.label}.`;
      } else {
        action = <span className="tag winner">friends</span>;
        hint = 'Already your friend.';
      }
  }

  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      aria-label={`${result.username}, ${elo} Elo, ${where}. ${hint}`}
      className={`search-row${active ? ' active' : ''}`}
      onMouseEnter={onHover}
    >
      <Avatar className="friend-avatar" name={result.username} url={result.avatarUrl} />
      <span className="search-main" aria-hidden>
        <strong className="search-name">
          <Highlight name={result.username} query={query} />
        </strong>
        <span className="search-meta">
          <span className={`friend-dot ${dot}`} />
          {elo} Elo · {where}
        </span>
      </span>
      <span className="search-action">{action}</span>
    </li>
  );
}

/** The letters that were typed, marked inside the name. */
function Highlight({ name, query }: { name: string; query: string }) {
  const at = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <mark className="search-hit">{name.slice(at, at + query.length)}</mark>
      {name.slice(at + query.length)}
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      className="search-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
