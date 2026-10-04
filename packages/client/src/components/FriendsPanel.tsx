import type { ModerationResult, OnlinePlayer, RoomSummary } from '@fmm/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptFriendRequest,
  listFriendships,
  removeFriendship,
  sendFriendRequest,
  type FriendsResult,
} from '../data/friends.js';
import {
  MISSING_TABLE_MESSAGE,
  friendRows,
  groupFriendships,
  type FriendAction,
  type FriendRow,
  type Friendship,
} from '../data/friendsModel.js';
import type { SearchResult } from '../data/playerSearch.js';
import { Avatar } from './Avatar.js';
import { FriendSearch } from './FriendSearch.js';

export interface FriendsPanelProps {
  /** The signed-in player's profile id. */
  userId: string;
  /** Who is online right now — the lobby feed from useGame. */
  online: OnlinePlayer[];
  /** Open rooms, so a friend's room can offer Join or Watch. */
  rooms: RoomSummary[];
  /** The room this browser is in, or null. Inviting needs one. */
  myRoomId: string | null;
  onJoin: (roomId: string) => void;
  onWatch: (roomId: string) => void;
  onInvite: (profileId: string) => Promise<ModerationResult>;
}

/**
 * How long "Invited" (or why not) replaces the Invite button. Matches the
 * server's cooldown, so the button comes back when inviting works again.
 */
const INVITE_NOTE_MS = 10_000;

interface Note {
  text: string;
  failed: boolean;
}

/**
 * The friends list on the profile page: requests waiting on you, requests you
 * sent, then your friends and where each one is right now.
 *
 * Friendships live in Supabase. Where a friend is comes from the live online
 * list, so a dot changes the moment they start or leave a game — only the
 * friendships themselves are refetched (on mount, after every change, and when
 * the window regains focus).
 */
export function FriendsPanel({
  userId,
  online,
  rooms,
  myRoomId,
  onJoin,
  onWatch,
  onInvite,
}: FriendsPanelProps) {
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  /** Profile pictures by profile id, read with the friendships. */
  const [pictures, setPictures] = useState<ReadonlyMap<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);

  const [adding, setAdding] = useState(false);
  /** How the last add, accept or remove went. */
  const [notice, setNotice] = useState<Note | null>(null);

  /** People with a change in flight, so their buttons cannot be pressed twice. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** The friend whose Remove is waiting for a second, deliberate click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** "Invited", or why not, per friend — shown for a few seconds. */
  const [inviteNotes, setInviteNotes] = useState<ReadonlyMap<string, Note>>(new Map());

  const alive = useRef(true);
  const loadCount = useRef(0);
  const noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    alive.current = true;
    const timers = noteTimers.current;
    return () => {
      alive.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++loadCount.current;
    const result = await listFriendships(userId);
    // The panel went away, or a newer load started, while this one was out.
    if (!alive.current || mine !== loadCount.current) return;
    setFriendships(result.friendships);
    setPictures(result.pictures);
    setLoadError(result.error);
    setMissingTable(result.missingTable);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const groups = useMemo(() => groupFriendships(friendships), [friendships]);
  const rows = useMemo(
    () => friendRows(groups.accepted, online, rooms, myRoomId),
    [groups, online, rooms, myRoomId],
  );
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.profileId, row])), [rows]);

  const markBusy = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** One friendship change for one person, then a fresh list. */
  async function change(otherId: string, work: () => Promise<FriendsResult>, success?: string) {
    markBusy(otherId, true);
    const result = await work();
    if (!alive.current) return;
    markBusy(otherId, false);
    if (!result.ok) setNotice({ text: result.message ?? 'That did not work.', failed: true });
    else setNotice(success ? { text: success, failed: false } : null);
    if (result.missingTable) setMissingTable(true);
    await refresh();
  }

  /** Add from the search: the request goes out by the exact name the search found. */
  async function addFromSearch(found: SearchResult): Promise<boolean> {
    if (busy.has(found.id)) return false;
    markBusy(found.id, true);
    const result = await sendFriendRequest(userId, found.username);
    if (!alive.current) return false;
    markBusy(found.id, false);
    setNotice({
      text: result.message ?? (result.ok ? `Request sent to ${found.username}.` : 'That did not work.'),
      failed: !result.ok,
    });
    if (result.missingTable) setMissingTable(true);
    await refresh();
    return result.ok;
  }

  async function acceptFromSearch(found: SearchResult): Promise<boolean> {
    await change(
      found.id,
      () => acceptFriendRequest(userId, found.id),
      `You and ${found.username} are friends now.`,
    );
    return true;
  }

  function showInviteNote(profileId: string, note: Note) {
    setInviteNotes((current) => new Map(current).set(profileId, note));
    const timers = noteTimers.current;
    const previous = timers.get(profileId);
    if (previous) clearTimeout(previous);
    timers.set(
      profileId,
      setTimeout(() => {
        timers.delete(profileId);
        setInviteNotes((current) => {
          const next = new Map(current);
          next.delete(profileId);
          return next;
        });
      }, INVITE_NOTE_MS),
    );
  }

  async function invite(profileId: string) {
    markBusy(profileId, true);
    const result = await onInvite(profileId);
    if (!alive.current) return;
    markBusy(profileId, false);
    showInviteNote(
      profileId,
      result.ok
        ? { text: 'Invited', failed: false }
        : { text: result.error ?? 'Could not invite.', failed: true },
    );
  }

  function run(row: FriendRow, action: FriendAction) {
    if (action.kind === 'watch') onWatch(action.roomId);
    else if (action.kind === 'join') onJoin(action.roomId);
    else void invite(row.profileId);
  }

  return (
    <section className="card friends-panel">
      <div className="friends-head">
        <h3>Friends · {groups.accepted.length}</h3>
        {!missingTable && (
          <button
            className="ghost small"
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
              setNotice(null);
            }}
          >
            {adding ? 'Close' : '+ Add friend'}
          </button>
        )}
      </div>

      {adding && !missingTable && (
        <FriendSearch
          userId={userId}
          friendships={friendships}
          online={online}
          friendRows={rowsById}
          busy={busy}
          inviteNotes={inviteNotes}
          onAdd={addFromSearch}
          onAccept={acceptFromSearch}
          onFriendAction={run}
          onClose={() => setAdding(false)}
        />
      )}

      {notice && (
        <p className={notice.failed ? 'form-error' : 'muted'} role="status">
          {notice.text}
        </p>
      )}

      {missingTable ? (
        <p className="muted">{MISSING_TABLE_MESSAGE}</p>
      ) : (
        <>
          {loadError && <p className="form-error">{loadError}</p>}

          {groups.incoming.length > 0 && (
            <ul className="list friend-list">
              {groups.incoming.map((request) => (
                <li key={request.otherId} className="friend-row">
                  <Avatar
                    className="friend-avatar"
                    name={request.otherName}
                    url={pictures.get(request.otherId)}
                  />
                  <span className="friend-main">
                    <strong className="friend-name">{request.otherName}</strong>
                    <span className="friend-status">wants to be friends</span>
                  </span>
                  <span className="friend-actions">
                    <button
                      className="ghost small"
                      disabled={busy.has(request.otherId)}
                      onClick={() =>
                        void change(request.otherId, () => removeFriendship(userId, request.otherId))
                      }
                    >
                      Decline
                    </button>
                    <button
                      className="small"
                      disabled={busy.has(request.otherId)}
                      onClick={() =>
                        void change(
                          request.otherId,
                          () => acceptFriendRequest(userId, request.otherId),
                          `You and ${request.otherName} are friends now.`,
                        )
                      }
                    >
                      Accept
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {groups.outgoing.length > 0 && (
            <ul className="list friend-list">
              {groups.outgoing.map((request) => (
                <li key={request.otherId} className="friend-row">
                  <Avatar
                    className="friend-avatar"
                    name={request.otherName}
                    url={pictures.get(request.otherId)}
                  />
                  <span className="friend-main">
                    <strong className="friend-name">{request.otherName}</strong>
                    <span className="friend-status">Request sent</span>
                  </span>
                  <span className="friend-actions">
                    <button
                      className="ghost small"
                      disabled={busy.has(request.otherId)}
                      onClick={() =>
                        void change(request.otherId, () => removeFriendship(userId, request.otherId))
                      }
                    >
                      Cancel
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!loaded ? (
            <p className="muted">Loading friends…</p>
          ) : rows.length === 0 ? (
            <p className="muted">No friends yet — press + Add friend and type a few letters of their name.</p>
          ) : (
            <ul className="list friend-list">
              {rows.map((row) => {
                const note = inviteNotes.get(row.profileId);
                const action = row.action;
                return (
                  <li key={row.profileId} className="friend-row">
                    <Avatar className="friend-avatar" name={row.name} url={pictures.get(row.profileId)} />
                    <span className="friend-main">
                      <strong className="friend-name">{row.name}</strong>
                      <span className="friend-status">
                        <span className={`friend-dot ${row.dot}`} aria-hidden />
                        {row.statusText}
                      </span>
                    </span>
                    <span className="friend-actions">
                      {confirming === row.profileId ? (
                        <>
                          <span className="muted">Remove?</span>
                          <button className="ghost small" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                          <button
                            className="danger small"
                            disabled={busy.has(row.profileId)}
                            onClick={() => {
                              setConfirming(null);
                              void change(
                                row.profileId,
                                () => removeFriendship(userId, row.profileId),
                                `${row.name} is no longer your friend.`,
                              );
                            }}
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <>
                          {note ? (
                            <span className={`friend-note${note.failed ? ' failed' : ''}`}>
                              {note.text}
                            </span>
                          ) : (
                            action && (
                              <button
                                className="ghost small"
                                disabled={busy.has(row.profileId)}
                                onClick={() => run(row, action)}
                              >
                                {action.label}
                              </button>
                            )
                          )}
                          <button
                            className="ghost small friend-remove"
                            title={`Remove ${row.name}`}
                            aria-label={`Remove ${row.name} from your friends`}
                            onClick={() => setConfirming(row.profileId)}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
