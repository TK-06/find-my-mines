import {
  isRoomFull,
  type MatchStatus,
  type OnlinePlayer,
  type RoomConfig,
  type RoomOrigin,
  type RoomSummary,
} from '@fmm/shared';
import { friendRows, type FriendRow, type Friendship } from './friendsModel.js';

/**
 * Pure rules for the "Invite friends" card on a room's waiting screen: when it
 * shows, who is on it, in what order, and what each friend's row offers. No
 * socket, no database, no React — the component only draws what this decides.
 */

/** The parts of the room these rules read, so a test needs no whole match state. */
export interface InviteRoom {
  status: MatchStatus;
  origin: RoomOrigin;
  config: RoomConfig;
  hostId: string | null;
  /** Seated players only; spectators are not in this list. */
  players: readonly { id: string }[];
}

/**
 * Whether this player has a seat to offer a friend: they are seated (a
 * spectator cannot ask anyone over), the room is not a game against the
 * computer, it is not full, and a private room's code goes out only on its
 * host's say-so.
 *
 * The room bar's "Post invite to world chat" follows the same rule, so the two
 * ways of asking someone over can never disagree about when they are there.
 */
export function hasSeatToOffer(room: Omit<InviteRoom, 'status'>, myId: string | null): boolean {
  if (myId === null || !room.players.some((p) => p.id === myId)) return false;
  if (room.origin === 'ai') return false;
  if (room.config.private && room.hostId !== myId) return false;
  return !isRoomFull(room.config, room.players.length);
}

/**
 * Whether the waiting screen shows the Invite friends card. Friendships belong
 * to accounts, so a guest never sees it; and it is the next step only while the
 * room is waiting — once the match starts the seats are spoken for.
 */
export function showInviteCard(room: InviteRoom, myId: string | null, signedIn: boolean): boolean {
  return signedIn && room.status === 'waiting' && hasSeatToOffer(room, myId);
}

/**
 * What the card has to say, from how the friendships load went.
 * - `hidden`: the friends table does not exist yet, so there is nothing to offer.
 * - `loading`: the first read is still out.
 * - `error`: the read failed (the list is empty then, which must not read as "no friends").
 * - `empty`: loaded, and there are no friends yet.
 * - `list`: friends to show.
 */
export type InviteCardView = 'hidden' | 'loading' | 'error' | 'empty' | 'list';

export function inviteCardView(
  load: { loaded: boolean; error: string | null; missingTable: boolean },
  friendCount: number,
): InviteCardView {
  if (load.missingTable) return 'hidden';
  if (!load.loaded) return 'loading';
  if (load.error) return 'error';
  return friendCount === 0 ? 'empty' : 'list';
}

/**
 * What a friend's row offers from this room:
 * - `invite`: online and free to come over — the Invite button.
 * - `here`: already in this room.
 * - `busy`: online, but somewhere else (a match, another room, a private room).
 * - `offline`: no connected tab.
 */
export type InviteSlot = 'invite' | 'here' | 'busy' | 'offline';

/** A friend's row on the card: the merged friends row, and where that leaves an invite. */
export interface RoomInviteRow extends FriendRow {
  slot: InviteSlot;
}

/** Said in place of "In room ABCD" for a friend sitting in the room being waited in. */
export const IN_THIS_ROOM_TEXT = 'In this room';

/** Invitable friends first, then those already here, then the busy, then the offline. */
const SLOT_ORDER: Record<InviteSlot, number> = { invite: 0, here: 1, busy: 2, offline: 3 };

/**
 * Accepted friends, merged with who is online (`friendRows`), and sorted for
 * inviting: the people the button works for come first, so the first few rows
 * are the useful ones. Within a group the order is friendsModel's — playing,
 * then online, then by name.
 *
 * A friend in some other room is not offered Invite, the same as on the
 * Friends card, where they are offered that room's Join or Watch instead (not
 * here: both would take you out of your own seat). Their status line says what
 * they are busy with. Everyone else who is online and not here is invitable.
 *
 * `memberIds` are the connection ids of everyone in this room, players and
 * spectators. The online list withholds a private room's code, so for a
 * friend in *this* private room the list says only "in a private room"; the
 * room's own member list is what shows they are here.
 */
export function roomInviteRows(
  friends: Friendship[],
  online: OnlinePlayer[],
  rooms: RoomSummary[],
  here: { roomId: string; memberIds: readonly string[] },
): RoomInviteRow[] {
  const members = new Set(here.memberIds);
  const inRoom = new Set(
    online.filter((tab) => tab.profileId !== null && members.has(tab.id)).map((tab) => tab.profileId),
  );

  return friendRows(friends, online, rooms, here.roomId)
    .map((row): RoomInviteRow => {
      if (inRoom.has(row.profileId) || row.roomId === here.roomId) {
        return { ...row, slot: 'here', statusText: IN_THIS_ROOM_TEXT };
      }
      if (row.presence === 'offline') return { ...row, slot: 'offline' };
      return { ...row, slot: row.action?.kind === 'invite' ? 'invite' : 'busy' };
    })
    .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
}

/** How many friends show before "Show all". */
export const INVITE_ROWS_SHOWN = 6;

/**
 * The rows to draw: all of them once expanded or when there are few enough,
 * else only the first `limit`. The invitable friends sort first, so what stays
 * in view is what the button works for.
 */
export function limitRows<T>(rows: readonly T[], expanded: boolean, limit = INVITE_ROWS_SHOWN): readonly T[] {
  return expanded || rows.length <= limit ? rows : rows.slice(0, limit);
}

/** Friends with a connected tab, for the card's "N online". */
export function onlineCount(rows: readonly RoomInviteRow[]): number {
  return rows.filter((row) => row.slot !== 'offline').length;
}
