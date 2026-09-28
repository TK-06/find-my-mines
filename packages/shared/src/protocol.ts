import type {
  AdminRoomView,
  AdminState,
  AiHintResult,
  AiLevel,
  ChatMessage,
  ForfeitNotice,
  FriendInvite,
  JoinRequestOutcome,
  LogLine,
  ModerationResult,
  OnlinePlayer,
  PublicMatchState,
  QueueSnapshot,
  RemovalNote,
  RemovalNotice,
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
  /** Set when this join resumed a seat held after a dropped connection. */
  roomId?: string;
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

  /**
   * Ask the host of an ask-to-join room for a seat. One pending request per
   * client: asking elsewhere, joining, creating or queueing withdraws it.
   */
  'room:requestJoin': (
    payload: { roomId: string },
    ack: (result: ModerationResult) => void,
  ) => void;
  /** Withdraw your pending request, if you have one. */
  'room:cancelRequest': () => void;
  /** Host only: let a requester in, or turn them away. */
  'room:answerRequest': (
    payload: { requesterId: string; accept: boolean },
    ack: (result: ModerationResult) => void,
  ) => void;

  /**
   * Host only, casual rooms a player created only. `ban` also stops the target
   * rejoining this room. The note is validated server-side.
   */
  'room:kick': (
    payload: { targetId: string; ban: boolean; note: RemovalNote },
    ack: (result: ModerationResult) => void,
  ) => void;

  /**
   * Signed-in players only: ask an online friend to join the room you are in.
   * The server checks the friendship itself — the client's word is not enough.
   */
  'friend:invite': (
    payload: { profileId: string },
    ack: (result: ModerationResult) => void,
  ) => void;

  /**
   * Start a game against a computer opponent: a new Classic-sized casual room
   * with you and the bot seated, started at once. Never rated.
   */
  'ai:play': (payload: { level: AiLevel }, ack: (result: RoomActionResult) => void) => void;
  /**
   * In a game against the computer, on your turn: which covered cell is most
   * likely a mine, and why. A few per match.
   */
  'ai:hint': (payload: Record<string, never>, ack: (result: AiHintResult) => void) => void;

  /** Say something in your room's chat. Players and spectators alike. */
  'room:say': (payload: { text: string }, ack: (result: ModerationResult) => void) => void;

  /** Matchmaking: join the pool for a mode, or leave it. */
  'queue:join': (payload: { mode: RoomMode }) => void;
  'queue:leave': () => void;

  /** Host only. Starts the first match, or the next one after a match ends. */
  'game:start': () => void;
  'game:reveal': (payload: { row: number; col: number }) => void;
  'game:rematch': () => void;
}

export interface ServerToClientEvents {
  /**
   * The landing page's game list and who is online. Sent on connect and on any
   * change. Spec: "the server will provide information about the other
   * connected client."
   */
  'lobby:rooms': (payload: {
    rooms: RoomSummary[];
    clientCount: number;
    online: OnlinePlayer[];
  }) => void;

  /** Full room snapshot. Sent on join/spectate, reset, and every match event. */
  'state:sync': (state: PublicMatchState) => void;
  'match:start': (state: PublicMatchState) => void;
  'cell:revealed': (payload: { cell: RevealedCell; state: PublicMatchState }) => void;
  'turn:changed': (payload: { currentPlayerId: string; secondsLeft: number }) => void;
  'turn:tick': (payload: { secondsLeft: number }) => void;
  'match:ended': (state: PublicMatchState) => void;
  'match:reset': (state: PublicMatchState) => void;
  /** The opponent left mid-match; the remaining player wins by forfeit. */
  'match:forfeit': (notice: ForfeitNotice) => void;
  /** Something happened in the room worth a toast, e.g. "Bob left the room." */
  'room:notice': (payload: { message: string }) => void;

  /** Queue progress while waiting. null means no longer queued. */
  'queue:status': (payload: QueueSnapshot | null) => void;
  /** A match was found — the client is already in the room by the time this lands. */
  'queue:matched': (payload: { roomId: string }) => void;

  /** The room was destroyed (everyone left, or an admin closed it). */
  'room:closed': (payload: { roomId: string; reason: string }) => void;

  /** You were kicked, banned, or your room was ended — and why. Sent only to you. */
  'player:removed': (notice: RemovalNotice) => void;

  /**
   * Your join request was answered (or the room closed). On 'accepted' the
   * room's state:sync follows right after this, on the same connection — the
   * client adopts the room here, so it knows that snapshot is meant for it.
   */
  'room:requestResolved': (payload: {
    roomId: string;
    roomName: string;
    outcome: JoinRequestOutcome;
    /** The host who answered, when there was one. */
    byName: string | null;
  }) => void;

  /**
   * The match you just played was saved to the database, under this id. Lets a
   * guest's browser remember its own games for the game log.
   */
  'match:recorded': (payload: { matchId: string }) => void;

  /** A friend invited you to the room they are in. Sent to each of your tabs. */
  'friend:invited': (invite: FriendInvite) => void;

  /** A line in your room's chat, from a player or the computer opponent. */
  'room:message': (message: ChatMessage) => void;

  'error:msg': (payload: { code: string; message: string }) => void;
}

/**
 * The server console's contract. Only the server machine itself, a verified
 * admin account, or a handshake carrying the server's ADMIN_TOKEN (when one is
 * set) may connect — anyone else gets a connect_error with ADMIN_ONLY_ERROR.
 */
export interface AdminToServerEvents {
  /** Spec: "The server has a reset button to reset the game and players' scores." */
  'admin:reset': (payload?: { roomId?: string }) => void;

  /** Out of their room (and the queue) and onto the kicked page. Stays connected. */
  'admin:kick': (
    payload: { clientId: string; note: RemovalNote },
    ack: (result: ModerationResult) => void,
  ) => void;
  /** Kicked, shown the banned page, then disconnected. Nothing is stored. */
  'admin:ban': (
    payload: { clientId: string; note: RemovalNote },
    ack: (result: ModerationResult) => void,
  ) => void;
  /** Ends a room: every member lands on the "room closed" page. */
  'admin:closeRoom': (
    payload: { roomId: string; note: RemovalNote },
    ack: (result: ModerationResult) => void,
  ) => void;

  /** Start watching a room, or stop with null. */
  'admin:watch': (payload: { roomId: string | null }) => void;
  /** The mine toggle for the watched room. */
  'admin:mines': (payload: { show: boolean }) => void;
}

export interface ServerToAdminEvents {
  'admin:state': (state: AdminState) => void;
  /** Terminal lines: a backfill on connect, then each new line as it happens. */
  'admin:log': (lines: LogLine[]) => void;
  /** The watched room. null once it closes or watching stops. */
  'admin:room': (view: AdminRoomView | null) => void;
}
