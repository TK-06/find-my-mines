import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptFriendRequest, listFriendships, sendFriendRequest, type FriendsResult } from './friends.js';
import {
  changeNotice,
  requestNotice,
  withBusy,
  type FriendAction,
  type FriendNote,
  type FriendRow,
  type Friendship,
  type InviteOutcome,
} from './friendsModel.js';
import type { SearchResult } from './playerSearch.js';

/**
 * How long "Invited" (or why not) replaces the Invite button. Matches the
 * server's cooldown, so the button comes back when inviting works again.
 */
const INVITE_NOTE_MS = 10_000;

/** What pressing a friend's live button does. */
export interface FriendActions {
  onJoin: (roomId: string) => void;
  onWatch: (roomId: string) => void;
  /**
   * Invite a friend, the way a player card's Invite does: sent now from a room,
   * else parked until the game being set up exists (answering `queued`). Left
   * out where nothing can be invited to.
   */
  onInvite?: (friend: { profileId: string; name: string }) => Promise<InviteOutcome>;
}

/**
 * My friendships and the things done to them, shared by the Friends card on
 * /profile and the lobby's "Find a player" box so the two cannot drift apart.
 *
 * Friendships live in Supabase, so they are fetched on mount, after every
 * change, and when the window regains focus. Where a friend is comes from the
 * live online list instead; the caller merges the two (`friendRows`).
 *
 * `userId` is null for a guest, who has no friendships: nothing is fetched and
 * every action refuses. The hook is still called, since hooks cannot be
 * conditional.
 */
export function useFriendships(userId: string | null, actions: FriendActions) {
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  /** Profile pictures by profile id, read with the friendships. */
  const [pictures, setPictures] = useState<ReadonlyMap<string, string>>(new Map());
  /** Their ratings by profile id, read with the friendships too. */
  const [elos, setElos] = useState<ReadonlyMap<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);

  /** How the last add, accept or remove went. */
  const [notice, setNotice] = useState<FriendNote | null>(null);
  /** People with a change in flight, so their buttons cannot be pressed twice. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** "Invited", or why not, per friend — shown for a few seconds. */
  const [inviteNotes, setInviteNotes] = useState<ReadonlyMap<string, FriendNote>>(new Map());

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
    if (!userId) return;
    const mine = ++loadCount.current;
    const result = await listFriendships(userId);
    // The component went away, or a newer load started, while this one was out.
    if (!alive.current || mine !== loadCount.current) return;
    setFriendships(result.friendships);
    setPictures(result.pictures);
    setElos(result.elos);
    setError(result.error);
    setMissingTable(result.missingTable);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const markBusy = (id: string, on: boolean) => setBusy((current) => withBusy(current, id, on));

  /**
   * One friendship change for one person, then a fresh list. Resolves with what
   * the change came to, for a caller (a player card) that has more to do on success.
   */
  async function change(
    otherId: string,
    work: () => Promise<FriendsResult>,
    success?: string,
  ): Promise<FriendsResult> {
    markBusy(otherId, true);
    const result = await work();
    if (!alive.current) return result;
    markBusy(otherId, false);
    setNotice(changeNotice(result, success));
    if (result.missingTable) setMissingTable(true);
    await refresh();
    return result;
  }

  /** Add from the search: the request goes out by the exact name the search found. */
  async function addFromSearch(found: SearchResult): Promise<boolean> {
    if (!userId || busy.has(found.id)) return false;
    markBusy(found.id, true);
    const result = await sendFriendRequest(userId, found.username);
    if (!alive.current) return false;
    markBusy(found.id, false);
    setNotice(requestNotice(result, found.username));
    if (result.missingTable) setMissingTable(true);
    await refresh();
    return result.ok;
  }

  async function acceptFromSearch(found: SearchResult): Promise<boolean> {
    if (!userId) return false;
    await change(
      found.id,
      () => acceptFriendRequest(userId, found.id),
      `You and ${found.username} are friends now.`,
    );
    return true;
  }

  function showInviteNote(profileId: string, note: FriendNote) {
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

  /**
   * Invite one friend, and say how it went beside their name for a few seconds.
   * The invite itself is App's (one for the cards and the rows): from a room it
   * goes out now; from the menu it is parked, the page moves on to Create game
   * and that form says who waits, so there is nothing to note here.
   */
  async function invite(friend: { profileId: string; name: string }) {
    if (!actions.onInvite) return;
    markBusy(friend.profileId, true);
    const result = await actions.onInvite(friend);
    if (!alive.current) return;
    markBusy(friend.profileId, false);
    if (result.queued) return;
    showInviteNote(
      friend.profileId,
      result.ok
        ? { text: 'Invited', failed: false }
        : { text: result.error ?? 'Could not invite.', failed: true },
    );
  }

  /** A friend's live button: Watch, Join / Ask, or Invite. */
  function run(row: FriendRow, action: FriendAction) {
    if (action.kind === 'watch') actions.onWatch(action.roomId);
    else if (action.kind === 'join') actions.onJoin(action.roomId);
    else void invite({ profileId: row.profileId, name: row.name });
  }

  return {
    friendships,
    pictures,
    elos,
    loaded,
    error,
    missingTable,
    refresh,
    busy,
    notice,
    setNotice,
    inviteNotes,
    change,
    addFromSearch,
    acceptFromSearch,
    run,
    invite,
  };
}

/**
 * What useFriendships hands back. One instance lives in App for the signed-in
 * player and is passed down, so the Friends card, the lobby's search and the
 * player cards all see the same list, and a change made in one shows in all.
 */
export type Friendships = ReturnType<typeof useFriendships>;
