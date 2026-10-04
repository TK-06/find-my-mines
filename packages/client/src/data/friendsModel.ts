import type { FriendInvite, OnlinePlayer, PresenceStatus, RoomSummary } from '@fmm/shared';

/**
 * Pure rules for the friends list: who is where, what each row offers, and
 * how invites pile up. No database, no socket, no clock — the components and
 * data/friends.ts do the I/O, this decides what it means.
 */

/** Shown in place of the list until migration 0003 has been run. */
export const MISSING_TABLE_MESSAGE =
  'Friends need a one-time database update — run supabase/migrations/0003_friends.sql.';

/** How long an invite popup stays before it quietly goes away. */
export const INVITE_TTL_MS = 60_000;

/** Invite popups on screen at once. Older ones make room for newer. */
export const MAX_INVITES = 3;

/**
 * Where someone in a private room is, for the friends and online lists. The
 * server withholds the room's code, so the words cannot name it either.
 */
export const PRIVATE_ROOM_TEXT = 'In a private room';

/** A friendship seen from the signed-in player's side. */
export interface Friendship {
  /** The other person's profile id. */
  otherId: string;
  otherName: string;
  status: 'pending' | 'accepted';
  /** 'outgoing' when I sent the request, 'incoming' when they did. */
  direction: 'incoming' | 'outgoing';
}

/** A row of public.friendships, as the database returns it. */
export interface FriendshipRecord {
  requester_id: string;
  addressee_id: string;
  status: string;
}

/**
 * Database rows as friendships from `myId`'s side. Rows that are not mine
 * (RLS already hides them — this is belt and braces) and statuses this client
 * does not know are dropped rather than guessed at.
 */
export function toFriendships(
  records: FriendshipRecord[],
  myId: string,
  names: ReadonlyMap<string, string>,
): Friendship[] {
  return records.flatMap((record) => {
    if (record.status !== 'pending' && record.status !== 'accepted') return [];
    const outgoing = record.requester_id === myId;
    if (!outgoing && record.addressee_id !== myId) return [];
    const otherId = outgoing ? record.addressee_id : record.requester_id;
    return [
      {
        otherId,
        otherName: names.get(otherId) ?? 'Unknown player',
        status: record.status,
        direction: outgoing ? 'outgoing' : 'incoming',
      },
    ];
  });
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Requests to me, requests from me, and friends — each in name order. */
export function groupFriendships(list: Friendship[]): {
  incoming: Friendship[];
  outgoing: Friendship[];
  accepted: Friendship[];
} {
  const sorted = [...list].sort((a, b) => byName({ name: a.otherName }, { name: b.otherName }));
  return {
    incoming: sorted.filter((f) => f.status === 'pending' && f.direction === 'incoming'),
    outgoing: sorted.filter((f) => f.status === 'pending' && f.direction === 'outgoing'),
    accepted: sorted.filter((f) => f.status === 'accepted'),
  };
}

/** The status dot: green online, yellow playing, grey offline. */
export type FriendDot = 'online' | 'playing' | 'offline';

/** The one button a friend's row offers. */
export type FriendAction =
  | { kind: 'watch'; roomId: string; label: 'Watch' }
  | { kind: 'join'; roomId: string; label: 'Join' | 'Ask' }
  | { kind: 'invite'; label: 'Invite' };

export interface FriendRow {
  profileId: string;
  name: string;
  /** Where they are; 'offline' when none of their tabs is connected. */
  presence: PresenceStatus | 'offline';
  roomId: string | null;
  dot: FriendDot;
  statusText: string;
  action: FriendAction | null;
}

/**
 * How busy each place is. A friend with several tabs open shows the busiest
 * one — the tab in a match matters more than one idling in the menu.
 */
const ACTIVITY: Record<PresenceStatus, number> = {
  playing: 4,
  room: 3,
  watching: 2,
  queue: 1,
  lobby: 0,
};

export function mostActiveTab(tabs: OnlinePlayer[]): OnlinePlayer | undefined {
  let best: OnlinePlayer | undefined;
  for (const tab of tabs) {
    if (!best || ACTIVITY[tab.status] > ACTIVITY[best.status]) best = tab;
  }
  return best;
}

function statusText(presence: FriendRow['presence'], roomId: string | null): string {
  switch (presence) {
    case 'queue':
      return 'Looking for a match';
    case 'room':
      return `In room ${roomId}`;
    case 'playing':
      return `Playing in ${roomId}`;
    case 'watching':
      return `Watching ${roomId}`;
    case 'offline':
      return 'Offline';
    default:
      return 'In the menu';
  }
}

function actionFor(
  presence: FriendRow['presence'],
  roomId: string | null,
  privateRoom: boolean,
  rooms: RoomSummary[],
  myRoomId: string | null,
): FriendAction | null {
  if (presence === 'offline') return null;

  // In a private room: there is no code to join or watch by, and they are
  // busy, so no Invite either. The room's link is theirs to share.
  if (privateRoom) return null;

  // Free to come over: only worth asking when there is a room to come to.
  if (roomId === null) return myRoomId ? { kind: 'invite', label: 'Invite' } : null;

  // Already together. Joining or watching "their" room would take me out of
  // my own seat first — mid-match, that is a forfeit.
  if (roomId === myRoomId) return null;

  if (presence === 'playing') return { kind: 'watch', roomId, label: 'Watch' };

  const room = rooms.find((r) => r.id === roomId);
  if (!room) return null;
  // Watching a match that is under way: watch it with them.
  if (room.status === 'playing') return { kind: 'watch', roomId, label: 'Watch' };
  if (room.joinable) {
    return { kind: 'join', roomId, label: room.config.joinByRequest ? 'Ask' : 'Join' };
  }
  return null;
}

const DOT_ORDER: Record<FriendDot, number> = { playing: 0, online: 1, offline: 2 };

/**
 * Accepted friends merged with who is online: where each one is, the dot, the
 * words, and the button. Playing first, then online, then offline, each by
 * name.
 */
export function friendRows(
  friends: Friendship[],
  online: OnlinePlayer[],
  rooms: RoomSummary[],
  myRoomId: string | null,
): FriendRow[] {
  const tabsByProfile = new Map<string, OnlinePlayer[]>();
  for (const tab of online) {
    // Guests have no profile, so they can never be anyone's friend.
    if (tab.profileId === null) continue;
    const tabs = tabsByProfile.get(tab.profileId) ?? [];
    tabs.push(tab);
    tabsByProfile.set(tab.profileId, tabs);
  }

  const rows = friends
    .filter((f) => f.status === 'accepted')
    .map((f): FriendRow => {
      const tab = mostActiveTab(tabsByProfile.get(f.otherId) ?? []);
      const presence = tab?.status ?? 'offline';
      const roomId = tab?.roomId ?? null;
      const privateRoom = tab?.privateRoom === true;
      return {
        profileId: f.otherId,
        name: f.otherName,
        presence,
        roomId,
        dot: presence === 'offline' ? 'offline' : presence === 'playing' ? 'playing' : 'online',
        statusText: privateRoom ? PRIVATE_ROOM_TEXT : statusText(presence, roomId),
        action: actionFor(presence, roomId, privateRoom, rooms, myRoomId),
      };
    });

  return rows.sort((a, b) => DOT_ORDER[a.dot] - DOT_ORDER[b.dot] || byName(a, b));
}

/** What "Add friend" should do, given anything already between the two of you. */
export type RequestPlan =
  | 'self'
  | 'send'
  | 'already-friends'
  | 'already-requested'
  | 'accept-theirs';

export function requestPlan(
  myId: string,
  targetId: string,
  existing: Friendship | undefined,
): RequestPlan {
  if (targetId === myId) return 'self';
  if (!existing) return 'send';
  if (existing.status === 'accepted') return 'already-friends';
  // They asked first: saying yes is what both of you want.
  return existing.direction === 'incoming' ? 'accept-theirs' : 'already-requested';
}

/** The friend button on a player card. */
export interface CardFriendButton {
  label: string;
  /** What pressing it does; 'none' means it is shown disabled. */
  does: 'add' | 'accept' | 'none';
  primary: boolean;
  /** Said under the buttons, when there is something to explain. */
  note: string | null;
}

/**
 * What the friend button says, given who is looking and what is already
 * between you. `existing` is undefined while it loads and 'unknown' when it
 * could not be read — then Add is offered and the request itself sorts it out.
 */
export function cardFriendButton(
  viewerSignedIn: boolean,
  existing: Friendship | null | 'unknown' | undefined,
): CardFriendButton {
  if (!viewerSignedIn) {
    return { label: 'Add friend', does: 'none', primary: true, note: 'Sign in to add friends.' };
  }
  if (existing === undefined) return { label: 'Add friend', does: 'none', primary: true, note: null };
  if (existing === null || existing === 'unknown') {
    return { label: 'Add friend', does: 'add', primary: true, note: null };
  }
  if (existing.status === 'accepted') return { label: 'Friends', does: 'none', primary: false, note: null };
  return existing.direction === 'incoming'
    ? { label: 'Accept request', does: 'accept', primary: true, note: 'They asked to be friends.' }
    : { label: 'Requested', does: 'none', primary: false, note: 'Waiting for them to accept.' };
}

/**
 * Adds an invite popup. A newer invite from the same friend to the same room
 * replaces the older one, and only the newest few are kept.
 */
export function addInvite(
  list: FriendInvite[],
  invite: FriendInvite,
  max = MAX_INVITES,
): FriendInvite[] {
  const others = list.filter(
    (i) => !(i.fromProfileId === invite.fromProfileId && i.roomId === invite.roomId),
  );
  return [...others, invite].slice(-max);
}

/**
 * The friendships table does not exist yet: PostgREST's "not in the schema
 * cache" (PGRST205) or Postgres's own "undefined table" (42P01).
 */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

/** The avatar letter. Whole characters, so a name starting with an emoji still works. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '?';
}
