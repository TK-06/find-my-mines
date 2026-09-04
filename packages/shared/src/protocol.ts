import type {
  AdminState,
  PublicMatchState,
  QueueSnapshot,
  RevealedCell,
  RoomConfig,
  RoomMode,
  RoomSummary,
  Seat,
} from './types.js';

/**
 * The socket contract between client and server.
 *
 * This file is the group's shared boundary — freeze it early, and the client,
 * server and future AI-bot work can all proceed in parallel without conflicts.
 *
 * Flow: connect -> player:join (nickname) -> lobby -> room:create / room:join /
 * room:spectate -> host game:start -> game:reveal ... -> match:ended ->
 * game:rematch or room:leave.
 */

export interface JoinResult {
  ok: boolean;
  playerId: string;
  /** Spec: "a welcome message with their nickname will appear". */
  welcome: string;
  /** True when no valid account token was supplied. */
  isGuest: boolean;
  /** Current rating; guests always get the starting value. */
  elo: number;
}

export interface RoomActionResult {
  ok: boolean;
  roomId?: string;
  seat?: Seat;
  /** Populated when ok is false — config errors, room full, room gone. */
  errors?: string[];
}

export interface ClientToServerEvents {
  /** Set a nickname. Sent once, before the lobby is shown. */
  'player:join': (payload: { nickname: string }, ack: (result: JoinResult) => void) => void;

  'room:create': (
    payload: { name: string; config: RoomConfig },
    ack: (result: RoomActionResult) => void,
  ) => void;
  'room:join': (payload: { roomId: string }, ack: (result: RoomActionResult) => void) => void;
  'room:spectate': (payload: { roomId: string }, ack: (result: RoomActionResult) => void) => void;
  'room:leave': () => void;

  /** Matchmaking: join the pool for a mode, or leave it. */
  'queue:join': (payload: { mode: RoomMode }) => void;
  'queue:leave': () => void;

  /** Host only. Starts the first match, or the next one after a match ends. */
  'game:start': () => void;
  'game:reveal': (payload: { row: number; col: number }) => void;
  'game:rematch': () => void;
}

export interface ServerToClientEvents {
  /** The landing page's game list. Sent on nickname join and on any room change. */
  'lobby:rooms': (payload: { rooms: RoomSummary[]; clientCount: number }) => void;

  /** Full room snapshot. Sent on join/spectate, reset, and every match event. */
  'state:sync': (state: PublicMatchState) => void;
  'match:start': (state: PublicMatchState) => void;
  'cell:revealed': (payload: { cell: RevealedCell; state: PublicMatchState }) => void;
  'turn:changed': (payload: { currentPlayerId: string; secondsLeft: number }) => void;
  'turn:tick': (payload: { secondsLeft: number }) => void;
  'match:ended': (state: PublicMatchState) => void;
  'match:reset': (state: PublicMatchState) => void;

  /** Queue progress while waiting. null means no longer queued. */
  'queue:status': (payload: QueueSnapshot | null) => void;
  /** A match was found — the client is already in the room by the time this lands. */
  'queue:matched': (payload: { roomId: string }) => void;

  /** The room was destroyed (everyone left, or an admin closed it). */
  'room:closed': (payload: { roomId: string; reason: string }) => void;

  'error:msg': (payload: { code: string; message: string }) => void;
}

export interface AdminToServerEvents {
  /** Spec: "The server has a reset button to reset the game and players' scores." */
  'admin:reset': (payload?: { roomId?: string }) => void;
}

export interface ServerToAdminEvents {
  'admin:state': (state: AdminState) => void;
}
