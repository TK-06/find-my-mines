import type { FriendInvite, OnlinePlayer, PresenceStatus, RoomSummary } from '@fmm/shared';
import { presenceLabel } from './format.js';

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
  /**
   * Their most active connection's id, for the one thing that needs a live
   * connection (reporting them); null when none of their tabs is connected.
   */
  connectionId: string | null;
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
        connectionId: tab?.id ?? null,
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

/** One line of feedback: how a request went, or why an invite did not. */
export interface FriendNote {
  text: string;
  failed: boolean;
}

/** What a friendship call answered. Structural, so this file never imports the I/O one. */
interface Answer {
  ok: boolean;
  message?: string;
}

/**
 * The people with a change in flight, with `id` added or taken away. A new set
 * each time, so React sees the change.
 */
export function withBusy(current: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(current);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/** What to say after a friend request went out — or why it did not. */
export function requestNotice(answer: Answer, username: string): FriendNote {
  return {
    text: answer.message ?? (answer.ok ? `Request sent to ${username}.` : 'That did not work.'),
    failed: !answer.ok,
  };
}

/**
 * What to say after accepting, declining, cancelling or removing: the failure
 * when it failed, `success` when it worked and there is something to say, else
 * nothing (the list changing is the news).
 */
export function changeNotice(answer: Answer, success?: string): FriendNote | null {
  if (!answer.ok) return { text: answer.message ?? 'That did not work.', failed: true };
  return success ? { text: success, failed: false } : null;
}

/**
 * Who a player card is about. Two things open one: a connection in the lobby's
 * Online now list, and a friend on /profile, who may well be offline. The card
 * only needs the handful of facts below, so both are boiled down to this.
 */
export interface CardSubject {
  name: string;
  /** Their account, null for a guest. */
  profileId: string | null;
  isGuest: boolean;
  avatarUrl: string | null;
  presence: PresenceStatus | 'offline';
  /** The dot beside "where": green online, yellow playing, grey offline. */
  dot: FriendDot;
  /** Where they are, in words. */
  where: string;
  /**
   * The connection to name in a report — their most active one. Null when they
   * are not connected, and then there is nobody the server could look up.
   */
  connectionId: string | null;
}

/** Someone in the Online now list, as a card subject. */
export function subjectOfTab(tab: OnlinePlayer): CardSubject {
  return {
    name: tab.nickname,
    profileId: tab.profileId,
    isGuest: tab.isGuest,
    avatarUrl: tab.avatarUrl ?? null,
    presence: tab.status,
    dot: tab.status === 'playing' ? 'playing' : 'online',
    where: tab.privateRoom ? PRIVATE_ROOM_TEXT : presenceLabel(tab),
    connectionId: tab.id,
  };
}

/**
 * An account we know by id and name — a friend, or someone who asked to be —
 * as a card subject, placed by the busiest of their connected tabs, or offline
 * when there is none. `picture` is the one from the friendships read; the
 * online list's own is the fallback.
 */
export function subjectOfPerson(
  person: { profileId: string; name: string; picture?: string | null },
  online: OnlinePlayer[],
): CardSubject {
  const tab = mostActiveTab(online.filter((t) => t.profileId === person.profileId));
  const presence = tab?.status ?? 'offline';
  return {
    name: person.name,
    profileId: person.profileId,
    isGuest: false,
    avatarUrl: person.picture ?? tab?.avatarUrl ?? null,
    presence,
    dot: presence === 'offline' ? 'offline' : presence === 'playing' ? 'playing' : 'online',
    where: tab?.privateRoom ? PRIVATE_ROOM_TEXT : statusText(presence, tab?.roomId ?? null),
    connectionId: tab?.id ?? null,
  };
}

/**
 * What pressing Invite does, which depends on where the viewer is.
 *
 * - `send`: already in a room that has a seat to offer, so the invite goes out now.
 * - `create`: in the menu, so a game is set up first and the invite follows it.
 * - `leave-computer`: in a game against the computer. That room cannot take a
 *   guest, and the menu (where a game is set up) is hidden behind it.
 * - `disconnected`: no connection or no name yet, so the server cannot be asked.
 */
export type InvitePlan = 'send' | 'create' | 'leave-computer' | 'disconnected';

export function invitePlan(here: {
  connected: boolean;
  /** This tab has joined under a name (an account's own, or a guest's). */
  named: boolean;
  inRoom: boolean;
  /** The room is a game against the computer. */
  vsComputer: boolean;
}): InvitePlan {
  if (!here.connected || !here.named) return 'disconnected';
  if (!here.inRoom) return 'create';
  return here.vsComputer ? 'leave-computer' : 'send';
}

/** Said under a friend's card when Invite cannot be pressed, and why. */
const INVITE_PLAN_NOTE: Record<Exclude<InvitePlan, 'send' | 'create'>, string> = {
  'leave-computer': 'Leave your game against the computer to invite a friend.',
  disconnected: 'Not connected to the server right now.',
};

/** What Invite needs to know to say what it will do. */
export interface InviteState {
  /** The friend has a tab connected. */
  friendOnline: boolean;
  plan: InvitePlan;
}

/** The friend button on a player card. */
export interface CardFriendButton {
  label: string;
  /** What pressing it does; 'none' means it is shown disabled. */
  does: 'add' | 'accept' | 'invite' | 'none';
  primary: boolean;
  /** Said under the buttons, when there is something to explain. */
  note: string | null;
}

/**
 * What the friend button says, given who is looking and what is already
 * between you. `existing` is undefined while it loads and 'unknown' when it
 * could not be read — then Add is offered and the request itself sorts it out.
 *
 * Once you are friends it becomes Invite, which is only live when the friend
 * is online and this tab is somewhere an invite can start from. `invite` is
 * left out where there is no way to invite from (a friend's public profile
 * page): there the button just says Friends.
 */
export function cardFriendButton(
  viewerSignedIn: boolean,
  existing: Friendship | null | 'unknown' | undefined,
  invite?: InviteState,
): CardFriendButton {
  if (!viewerSignedIn) {
    return { label: 'Add friend', does: 'none', primary: true, note: 'Sign in to add friends.' };
  }
  if (existing === undefined) return { label: 'Add friend', does: 'none', primary: true, note: null };
  if (existing === null || existing === 'unknown') {
    return { label: 'Add friend', does: 'add', primary: true, note: null };
  }
  if (existing.status === 'accepted') {
    if (!invite) return { label: 'Friends', does: 'none', primary: false, note: null };
    if (!invite.friendOnline) {
      return { label: 'Invite', does: 'none', primary: false, note: "They're offline." };
    }
    if (invite.plan === 'send' || invite.plan === 'create') {
      return { label: 'Invite', does: 'invite', primary: true, note: null };
    }
    return { label: 'Invite', does: 'none', primary: false, note: INVITE_PLAN_NOTE[invite.plan] };
  }
  return existing.direction === 'incoming'
    ? { label: 'Accept request', does: 'accept', primary: true, note: 'They asked to be friends.' }
    : { label: 'Requested', does: 'none', primary: false, note: 'Waiting for them to accept.' };
}

/**
 * How an invite from a card went, for the card and for the toast: sent now, or
 * parked until the game it will be sent from has been created.
 */
export interface InviteOutcome {
  ok: boolean;
  error?: string;
  /** The invite waits for the game being set up; the card has nothing more to say. */
  queued?: boolean;
}

/** The line shown on the Create game form while an invite waits for it. */
export function pendingInviteLine(name: string): string {
  return `${name} will be invited when you create the game.`;
}

/** What to say once the game has been made and the waiting invite went (or did not). */
export function pendingInviteNotice(name: string, result: { ok: boolean; error?: string }): string {
  return result.ok ? `Invited ${name}.` : `Could not invite ${name}: ${result.error ?? 'try again from the room.'}`;
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
