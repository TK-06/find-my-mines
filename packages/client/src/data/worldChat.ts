import type { LobbyInvite, LobbyMessage, RoomSummary } from '@fmm/shared';

/**
 * Pure rules for the lobby's world chat: which lines to keep, and what an
 * invite card's Join button can offer right now. No socket, no DOM — useGame
 * and WorldChat do the I/O, this decides what it means. Grouping and times
 * are shared with the room chat, in chat.ts.
 */

/** Lines kept on screen. The server keeps a shorter history for newcomers. */
export const LOBBY_CHAT_LIMIT = 100;

function isInvite(value: unknown): value is LobbyInvite {
  const invite = value as Partial<LobbyInvite> | null | undefined;
  return (
    typeof invite === 'object' &&
    invite !== null &&
    typeof invite.roomId === 'string' &&
    typeof invite.roomName === 'string' &&
    typeof invite.rows === 'number' &&
    typeof invite.cols === 'number' &&
    typeof invite.mineCount === 'number' &&
    typeof invite.playerCount === 'number' &&
    (invite.maxPlayers === null || typeof invite.maxPlayers === 'number')
  );
}

/**
 * Whether something from the network is a line this client can show. An
 * invite card must carry its room, or it has nothing to offer a Join for.
 */
export function isLobbyMessage(value: unknown): value is LobbyMessage {
  const message = value as Partial<LobbyMessage> | null | undefined;
  if (typeof message !== 'object' || message === null) return false;
  if (
    typeof message.id !== 'string' ||
    typeof message.fromId !== 'string' ||
    typeof message.fromName !== 'string' ||
    typeof message.text !== 'string' ||
    typeof message.at !== 'number'
  ) {
    return false;
  }
  return message.kind === 'player' || (message.kind === 'invite' && isInvite(message.invite));
}

/**
 * Adds a line from the server: each once, only the newest `limit`. Returns
 * the same list when nothing changed, so React skips the re-render.
 */
export function addLobbyMessage(
  list: LobbyMessage[],
  message: unknown,
  limit = LOBBY_CHAT_LIMIT,
): LobbyMessage[] {
  if (!isLobbyMessage(message)) return list;
  if (list.some((m) => m.id === message.id)) return list;
  return [...list, message].slice(-limit);
}

/**
 * The history the server sends after we pick a name. It replaces whatever we
 * had: anything broadcast before it is already in it, and anything after it
 * arrives as its own line.
 */
export function lobbyHistory(history: unknown, limit = LOBBY_CHAT_LIMIT): LobbyMessage[] {
  if (!Array.isArray(history)) return [];
  return history.reduce<LobbyMessage[]>((list, message) => addLobbyMessage(list, message, limit), []);
}

/** What an invite card's button offers, and the room's numbers as they are now. */
export interface InviteAvailability {
  canJoin: boolean;
  label: 'Join' | 'Join next' | 'Ask' | 'Full' | 'Room closed';
  playerCount: number;
  maxPlayers: number | null;
}

/**
 * Reads the card against the live game list, so an old card does not offer a
 * seat that is gone. A listed room answers for itself: Full when it has no
 * seat, Ask when it now asks to join, Join next mid-match (a joiner watches
 * until it ends — the game list says the same). A listed room missing from the
 * list has closed. A private room is never listed, so its card keeps what it
 * said when posted — joining still asks the server, which has the last word.
 */
export function inviteAvailability(invite: LobbyInvite, rooms: RoomSummary[]): InviteAvailability {
  const room = rooms.find((r) => r.id === invite.roomId);
  if (room) {
    const counts = { playerCount: room.playerCount, maxPlayers: room.config.maxPlayers };
    if (!room.joinable) return { canJoin: false, label: 'Full', ...counts };
    const label = room.config.joinByRequest ? 'Ask' : room.status === 'playing' ? 'Join next' : 'Join';
    return { canJoin: true, label, ...counts };
  }
  const counts = { playerCount: invite.playerCount, maxPlayers: invite.maxPlayers };
  if (invite.private !== true) return { canJoin: false, label: 'Room closed', ...counts };
  return { canJoin: true, label: invite.joinByRequest ? 'Ask' : 'Join', ...counts };
}
