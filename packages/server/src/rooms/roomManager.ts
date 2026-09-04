import {
  coerceRoomConfig,
  generateRoomId,
  validateRoomConfig,
  type RoomConfig,
  type RoomSummary,
} from '@fmm/shared';
import { MatchManager, type MatchBroadcaster } from '../match/matchManager.js';

export interface CreateResult {
  ok: boolean;
  roomId?: string;
  errors?: string[];
}

/**
 * Owns every open room.
 *
 * A client is in at most one room at a time, tracked by `memberRoom`, so
 * joining elsewhere or disconnecting always finds the room to clean up.
 */
export class RoomManager {
  private readonly rooms = new Map<string, MatchManager>();
  private readonly memberRoom = new Map<string, string>();

  constructor(private readonly broadcasterFor: (roomId: string) => MatchBroadcaster) {}

  list(): RoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => room.summary())
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  get(roomId: string): MatchManager | undefined {
    return this.rooms.get(roomId);
  }

  /** The room a client currently occupies, if any. */
  roomOf(clientId: string): MatchManager | undefined {
    const roomId = this.memberRoom.get(clientId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  roomIdOf(clientId: string): string | null {
    return this.memberRoom.get(clientId) ?? null;
  }

  /** Validates untrusted input, then creates the room with its creator seated. */
  create(name: string, rawConfig: Partial<RoomConfig> | undefined): CreateResult {
    const config = coerceRoomConfig(rawConfig);
    const errors = validateRoomConfig(config);
    if (errors.length > 0) return { ok: false, errors };

    const cleanName = String(name ?? '').trim().slice(0, 32) || 'Untitled room';
    const roomId = generateRoomId((id) => this.rooms.has(id));

    this.rooms.set(
      roomId,
      new MatchManager(roomId, cleanName, config, this.broadcasterFor(roomId)),
    );
    return { ok: true, roomId };
  }

  /** Records membership. The caller seats them via the room itself. */
  track(clientId: string, roomId: string): void {
    this.memberRoom.set(clientId, roomId);
  }

  /**
   * Removes a client from whatever room they are in, closing the room if that
   * left it empty. Returns the room they left, so the caller can leave the
   * socket.io room and refresh the lobby.
   */
  leave(clientId: string): { roomId: string | null; closed: boolean } {
    const roomId = this.memberRoom.get(clientId);
    if (!roomId) return { roomId: null, closed: false };

    this.memberRoom.delete(clientId);
    const room = this.rooms.get(roomId);
    if (!room) return { roomId, closed: false };

    const nowEmpty = room.remove(clientId);
    if (nowEmpty) {
      this.rooms.delete(roomId);
      return { roomId, closed: true };
    }
    return { roomId, closed: false };
  }

  /** Admin reset: one room, or every room when no id is given. */
  reset(roomId?: string): void {
    if (roomId) {
      this.rooms.get(roomId)?.resetAll();
      return;
    }
    for (const room of this.rooms.values()) room.resetAll();
  }
}
