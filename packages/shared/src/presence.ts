import type { MatchStatus, PresenceStatus, Seat } from './types.js';

export interface PresenceInput {
  inQueue: boolean;
  /** The room the client occupies, or null. */
  roomId: string | null;
  seat: Seat;
  /** That room's match status, or null when not in a room. */
  roomStatus: MatchStatus | null;
}

/** Where a connected player is, as the lobby's online list describes it. */
export function presenceOf({ inQueue, roomId, seat, roomStatus }: PresenceInput): PresenceStatus {
  if (roomId !== null) {
    if (seat === 'spectator') return 'watching';
    return roomStatus === 'playing' ? 'playing' : 'room';
  }
  return inQueue ? 'queue' : 'lobby';
}
