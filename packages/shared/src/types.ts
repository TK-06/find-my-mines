/** What a revealed cell turned out to be. */
export type RevealKind = 'bomb' | 'empty';

/** A seat at the table. Clients beyond the room's limit watch instead. */
export type Seat = 'player' | 'spectator';

export type MatchStatus = 'waiting' | 'playing' | 'ended';

/** Ranked matches move Elo. Casual matches are recorded but do not. */
export type RoomMode = 'casual' | 'ranked';

/**
 * How a room came to exist. A matchmade room has no host anyone chose, so the
 * host's moderation powers do not apply there. An 'ai' room is one player
 * against a computer opponent.
 */
export type RoomOrigin = 'created' | 'matchmaking' | 'ai';

/** How hard a computer opponent plays. */
export type AiLevel = 'easy' | 'medium' | 'hard';

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
  /**
   * Players ask the host to take a seat instead of joining directly. Custom
   * rooms only — a Classic room is always open. Absent means open.
   */
  joinByRequest?: boolean;
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
  /** Set on a computer opponent's seat: how hard it plays. */
  bot?: AiLevel;
}

/** One line in a room's chat. Not stored anywhere — it lives as long as the room. */
export interface ChatMessage {
  id: string;
  roomId: string;
  fromId: string;
  fromName: string;
  kind: 'player' | 'bot';
  text: string;
  /** Server time, epoch milliseconds. */
  at: number;
}

/** The answer to asking for a hint in a game against the computer. */
export interface AiHintResult {
  ok: boolean;
  error?: string;
  row?: number;
  col?: number;
  /** Why this cell, in a sentence. */
  text?: string;
  hintsLeft?: number;
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
  /** True until a verified account says otherwise. */
  isGuest: boolean;
}

/** Where a connected player is right now, for the lobby's online list. */
export type PresenceStatus = 'lobby' | 'queue' | 'room' | 'playing' | 'watching';

/**
 * One row of the players' online list.
 *
 * Spec: "the server will provide information about the other connected
 * client." Deliberately carries no network address — that is admin-only.
 */
export interface OnlinePlayer {
  id: string;
  nickname: string;
  isGuest: boolean;
  status: PresenceStatus;
  /** Set for room, playing and watching. */
  roomId: string | null;
  /**
   * The account behind this connection, null for a guest. Profile ids are
   * already public (the game log shows them); a client needs this to find its
   * friends in the list.
   */
  profileId: string | null;
}

/** A friend asked you to join the room they are in. */
export interface FriendInvite {
  /** Unique per invite, so the client can dismiss one. */
  id: string;
  fromName: string;
  fromProfileId: string;
  roomId: string;
  roomName: string;
  /** When the server sent it, in epoch milliseconds. */
  sentAt: number;
}

/** A spectator, as listed to everyone in the room. */
export interface SpectatorPublic {
  id: string;
  nickname: string;
}

/** Someone waiting for the host to let them into an ask-to-join room. */
export interface JoinRequestPublic {
  id: string;
  nickname: string;
  isGuest: boolean;
}

/** How a join request ended, as told to the person who asked. */
export type JoinRequestOutcome = 'accepted' | 'declined' | 'closed';

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
  /** Whether a player created the room or matchmaking did. */
  origin: RoomOrigin;
  status: MatchStatus;
  rows: number;
  cols: number;
  bombCount: number;
  bombsFound: number;
  players: PlayerPublic[];
  spectatorCount: number;
  /** Who is watching, oldest first. */
  spectators: SpectatorPublic[];
  /** Pending asks to join, oldest first. Only the host can answer them. */
  joinRequests: JoinRequestPublic[];
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

// ── moderation ──────────────────────────────────────────────────────────────

/** Preset reasons offered by the kick/ban dialog. Labels live in moderation.ts. */
export type RemovalReason = 'afk' | 'offensive-name' | 'harassment' | 'cheating' | 'other';

/** Why someone was removed: at least one reason or a remark, validated server-side. */
export interface RemovalNote {
  reasons: RemovalReason[];
  remark: string;
}

export type RemovalKind = 'kicked' | 'banned' | 'room-closed';

/** Sent to a player who was removed, so their screen can say what happened. */
export interface RemovalNotice {
  kind: RemovalKind;
  by: 'host' | 'admin';
  /** The host's nickname when a host did it; null for an admin. */
  byName: string | null;
  roomId: string | null;
  roomName: string | null;
  /** Host ban: this player may not rejoin the room. */
  roomBan: boolean;
  note: RemovalNote;
}

export interface ModerationResult {
  ok: boolean;
  error?: string;
}

// ── server console ──────────────────────────────────────────────────────────

export type LogKind =
  | 'connection'
  | 'player'
  | 'room'
  | 'queue'
  | 'match'
  | 'moderation'
  | 'admin'
  | 'traffic'
  /** A handler failed and was contained; the server kept running. */
  | 'error';

/** One line of the console's terminal panel. */
export interface LogLine {
  /** Increasing; doubles as a React key. */
  id: number;
  at: number;
  kind: LogKind;
  text: string;
}

export interface MinePosition {
  row: number;
  col: number;
}

/**
 * The room an admin is watching. `mines` is null unless that admin turned the
 * mine toggle on — and it only ever travels on the /admin namespace.
 */
export interface AdminRoomView {
  state: PublicMatchState;
  mines: MinePosition[] | null;
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
