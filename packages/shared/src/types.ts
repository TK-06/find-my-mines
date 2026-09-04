/** What a revealed cell turned out to be. */
export type RevealKind = 'bomb' | 'empty';

/** A seat at the table. Clients beyond the room's limit watch instead. */
export type Seat = 'player' | 'spectator';

export type MatchStatus = 'waiting' | 'playing' | 'ended';

/**
 * Per-room settings, chosen when the room is created.
 * `maxPlayers: null` means unlimited seats.
 */
export interface RoomConfig {
  rows: number;
  cols: number;
  mineCount: number;
  maxPlayers: number | null;
}

export interface PlayerPublic {
  id: string;
  nickname: string;
  /** Bombs found in the CURRENT match. Resets every match. */
  score: number;
  /** Bombs found across all matches in this room. Only Reset clears it. */
  totalScore: number;
  connected: boolean;
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

export interface AdminState {
  /** Spec: "the number of concurrent clients currently connected". */
  clientCount: number;
  /** Spec: "a list of those connected clients". */
  clients: ClientInfo[];
  rooms: RoomSummary[];
  serverStartedAt: number;
}
