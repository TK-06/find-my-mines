/** What a revealed cell turned out to be. */
export type RevealKind = 'bomb' | 'empty';

/** A seat at the table. Clients beyond the room's limit watch instead. */
export type Seat = 'player' | 'spectator';

export type MatchStatus = 'waiting' | 'playing' | 'ended';

/** Ranked matches move Elo. Casual matches are recorded but do not. */
export type RoomMode = 'casual' | 'ranked';

/**
 * Per-room settings, chosen when the room is created.
 * `maxPlayers: null` means unlimited seats.
 */
export interface RoomConfig {
  rows: number;
  cols: number;
  mineCount: number;
  maxPlayers: number | null;
  mode: RoomMode;
}

export interface PlayerPublic {
  id: string;
  nickname: string;
  /** Bombs found in the CURRENT match. Resets every match. */
  score: number;
  /** Bombs found across all matches in this room. Only Reset clears it. */
  totalScore: number;
  connected: boolean;
  /** Current rating. Guests always show the starting value. */
  elo: number;
  /** True when this seat has no account — rating is not persisted. */
  isGuest: boolean;
  /** Set for the duration of the end-of-match screen after a ranked game. */
  eloDelta?: number;
}

/**
 * Who a socket belongs to. Resolved server-side from the handshake token —
 * never from anything the client claims about itself.
 */
export interface Identity {
  /** Supabase user id, or null for a guest. */
  profileId: string | null;
  nickname: string;
  elo: number;
  gamesPlayed: number;
  isGuest: boolean;
}

/** A connected client as shown in the server console's client list. */
export interface ClientInfo {
  id: string;
  nickname: string;
  seat: Seat;
  connectedAt: number;
  address: string;
  /** Which room they are in, or null while they are on the landing page. */
  roomId: string | null;
}

/** One revealed cell, as broadcast to a room. Bomb positions are never sent. */
export interface RevealedCell {
  row: number;
  col: number;
  kind: RevealKind;
  /** Bombs in the 8 surrounding slots. Only meaningful when kind === 'empty'. */
  adjacent: number;
  byPlayerId: string;
}

/** Everything a client in a room is allowed to know. */
export interface PublicMatchState {
  roomId: string;
  roomName: string;
  /** Whoever may press Start. Reassigned to the earliest joiner if the host leaves. */
  hostId: string | null;
  config: RoomConfig;
  status: MatchStatus;
  rows: number;
  cols: number;
  bombCount: number;
  bombsFound: number;
  players: PlayerPublic[];
  spectatorCount: number;
  currentPlayerId: string | null;
  secondsLeft: number;
  revealed: RevealedCell[];
  /** Set once status === 'ended'. null means a draw. */
  winnerId: string | null;
  /** Ids of players who have voted for a rematch. */
  rematchVotes: string[];
}

/**
 * Sent when a match ends because the other side left. The room itself goes
 * back to waiting, so this is the only record of the result on the client.
 */
export interface ForfeitNotice {
  roomId: string;
  winnerId: string;
  winnerNickname: string;
  leaverNickname: string;
  players: { id: string; nickname: string; score: number; eloDelta?: number }[];
}

/** One row of the landing page's game list. */
export interface RoomSummary {
  id: string;
  name: string;
  hostNickname: string;
  config: RoomConfig;
  playerCount: number;
  spectatorCount: number;
  status: MatchStatus;
  createdAt: number;
  /** False when the room is full, so the client shows Spectate only. */
  joinable: boolean;
}

/** What a waiting player is told about their own place in the queue. */
export interface QueueSnapshot {
  mode: RoomMode;
  waitedMs: number;
  /** Current Elo tolerance — widens the longer they wait. */
  eloWindow: number;
  /** How many players are waiting in the same mode, including them. */
  queued: number;
}

/** One row of the server console's matchmaking pool. */
export interface QueuePoolRow {
  id: string;
  nickname: string;
  elo: number;
  mode: RoomMode;
  waitedMs: number;
  eloWindow: number;
}

export interface AdminState {
  /** Spec: "the number of concurrent clients currently connected". */
  clientCount: number;
  /** Spec: "a list of those connected clients". */
  clients: ClientInfo[];
  rooms: RoomSummary[];
  /** Live matchmaking pool. */
  queue: QueuePoolRow[];
  serverStartedAt: number;
}
