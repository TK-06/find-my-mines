import type { Identity, LobbyInvite, LobbyMessage, RoomSummary } from '@fmm/shared';
import { ChatLimit } from './chatLimit.js';

/** Lines the world chat keeps for whoever arrives next. Older ones are gone for good. */
export const LOBBY_HISTORY_LIMIT = 50;

/** How long one connection waits between invite cards. */
export const LOBBY_INVITE_COOLDOWN_MS = 30_000;

/**
 * The lobby's world chat, in server memory only: the last few dozen lines, so
 * a newcomer sees what people were just talking about. Nothing reaches the
 * database, and a restart (or an admin) empties it. Pure — no sockets here.
 */
export class LobbyChat {
  private lines: LobbyMessage[] = [];

  constructor(private readonly limit = LOBBY_HISTORY_LIMIT) {}

  add(message: LobbyMessage): void {
    this.lines.push(message);
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
  }

  /** Oldest first. A copy, so nobody can edit what the next newcomer is sent. */
  history(): LobbyMessage[] {
    return [...this.lines];
  }

  /** Empties the chat; returns how many lines went, for the console's log. */
  clear(): number {
    const removed = this.lines.length;
    this.lines = [];
    return removed;
  }

  get size(): number {
    return this.lines.length;
  }
}

/** One invite card per connection per cooldown: a card is big, so it floods faster than a line. */
export function lobbyInviteLimit(): ChatLimit {
  return new ChatLimit(1, LOBBY_INVITE_COOLDOWN_MS);
}

/** Who sent a line, as the server verified it — never what the client claims. */
export type LobbySender = Pick<Identity, 'nickname' | 'isGuest' | 'avatarUrl'>;

/** What every world-chat line carries, whatever its kind. */
export interface LineMeta {
  id: string;
  /** The sender's connection id. */
  fromId: string;
  sender: LobbySender;
  at: number;
}

function header({ id, fromId, sender, at }: LineMeta) {
  return {
    id,
    fromId,
    fromName: sender.nickname,
    isGuest: sender.isGuest,
    fromAvatarUrl: sender.avatarUrl ?? null,
    at,
  };
}

/** A line someone typed. `text` must already be cleaned (cleanChatText). */
export function playerLine(meta: LineMeta, text: string): LobbyMessage {
  return { ...header(meta), kind: 'player', text };
}

/** The room as its card shows it, taken from the same summary the game list uses. */
export function inviteFor(room: RoomSummary): LobbyInvite {
  const { config } = room;
  return {
    roomId: room.id,
    roomName: room.name,
    rows: config.rows,
    cols: config.cols,
    mineCount: config.mineCount,
    playerCount: room.playerCount,
    maxPlayers: config.maxPlayers,
    mode: config.mode,
    joinByRequest: config.joinByRequest === true,
    // Only when set, so a listed room's card serialises without it.
    ...(config.private === true ? { private: true } : {}),
  };
}

/** "Alice invited everyone to Friday night", with the room's card attached. */
export function inviteLine(meta: LineMeta, room: RoomSummary): LobbyMessage {
  return {
    ...header(meta),
    kind: 'invite',
    text: `${meta.sender.nickname} invited everyone to ${room.name}`,
    invite: inviteFor(room),
  };
}

/**
 * Why this connection may not post an invite card, or null when it may.
 *
 * Only a seated player advertises their table: a spectator inviting people
 * into a game they are not playing would be odd. A full room is refused
 * because nobody reading the card could take a seat. And a private room's
 * code only goes public on its host's say-so — the whole point of a private
 * room is that the host chooses who gets the code.
 */
export function inviteRefusal(input: {
  room: RoomSummary | null;
  seated: boolean;
  isHost: boolean;
}): string | null {
  const { room, seated, isHost } = input;
  if (!room) return 'Join or create a room first.';
  if (!seated) return 'Only players can post an invite — take a seat first.';
  if (room.config.private === true && !isHost) return 'Only the host can share a private room.';
  if (!room.joinable) return 'Your room is full — nobody could join.';
  return null;
}
