import type {
  AdminRoomView,
  AdminState,
  AiAbout,
  AiDensity,
  AiHintResult,
  AiLevel,
  AiModel,
  ChatMessage,
  ForfeitNotice,
  LobbyMessage,
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
import type { PlayerReport, ReportReason, ReportStatus } from './reports.js';
import type { Replay } from './replay.js';

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

export interface RoomLookupResult {
  ok: boolean;
  /** The room as the game list would show it. Set when ok. */
  room?: RoomSummary;
  /** Why not — usually that the room no longer exists. */
  error?: string;
}

/**
 * Which finished game a review request is about: the id the server keeps the
 * replay under in memory (from `match:replay`), the id of the saved match, or
 * both. Either is enough; the replay itself is never taken from the client.
 */
export interface ReviewRef {
  replayId?: string;
  matchId?: string;
}

/** The finished match's replay, sent to the whole room once the match is over. */
export interface MatchReplayNotice {
  roomId: string;
  /** What the server keeps the replay under in memory, for the coach. */
  replayId: string;
  /** The saved match's id, when it is known yet; `match:recorded` says it later. */
  matchId: string | null;
  replay: Replay;
  /** The coach can answer questions about this game (the server has a Groq key for it). */
  coach: boolean;
}

/** A Fruit Fly move's public-board-only neural activity, sent just before the reveal. */
export interface FlyThoughtNotice {
  roomId: string;
  botId: string;
  /** The number of cells already revealed when the fly chose this move. */
  move: number;
  pick: { row: number; col: number };
  steps: number;
  neurons: number;
  /** One byte per rate, base64-encoded in step-major order. */
  rates: string;
  /** At most 40 display candidates; larger frontiers show the pick and best-scoring alternatives. */
  candidates: { row: number; col: number; score: number }[];
}

/** Whether the coach can be asked about a game, and how many questions this person has left. */
export interface ReviewCoachResult {
  ok: boolean;
  available: boolean;
  questionsLeft?: number;
  error?: string;
}

/** The coach's answer. A refusal or a failure spends no question, and says why in `error`. */
export interface ReviewAskResult {
  ok: boolean;
  answer?: string;
  questionsLeft?: number;
  error?: string;
}

export interface ClientToServerEvents {
  /**
   * Set a nickname. Sent once, before the lobby is shown. A guest also sends
   * the random id from its fmm_guest cookie: the server keeps it in memory and
   * uses it only to label a report (sent by or about this guest).
   */
  'player:join': (
    payload: { nickname: string; guestId?: string },
    ack: (result: JoinResult) => void,
  ) => void;

  /**
   * Report someone in the online list to the server's admins. Guests may too.
   * Who sent it, and from where, is filled in by the server from its own
   * records of both connections — nothing here is taken on trust but the
   * reason and the details.
   */
  'player:report': (
    payload: { targetId: string; reason: ReportReason; details?: string },
    ack: (result: ModerationResult) => void,
  ) => void;

  'room:create': (
    payload: { name: string; config: RoomConfig },
    ack: (result: RoomActionResult) => void,
  ) => void;
  'room:join': (payload: { roomId: string }, ack: (result: RoomActionResult) => void) => void;
  'room:spectate': (payload: { roomId: string }, ack: (result: RoomActionResult) => void) => void;
  /**
   * One room's summary, by its code — private rooms included, since the code
   * is what lets you in. A join link or "Join by code" needs it to tell an
   * ask-to-join room (open the request dialog) from an open one.
   */
  'room:lookup': (payload: { roomId: string }, ack: (result: RoomLookupResult) => void) => void;
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
   * Start a game against a computer opponent: a new casual room with you and
   * the bot seated, started at once. Never rated. The board is chosen by name
   * (a size from AI_BOARD_SIZES and a density) and the server works out the
   * numbers; both default to the Classic 6×6 with 11 mines. A model that is
   * not playable yet (JEV) is refused.
   */
  'ai:play': (
    payload: { level: AiLevel; model: AiModel; size?: number; density?: AiDensity },
    ack: (result: RoomActionResult) => void,
  ) => void;
  /** Which language model the "AI" opponent uses here, for the lobby's info popup. */
  'ai:about': (payload: Record<string, never>, ack: (result: AiAbout) => void) => void;
  /**
   * In a game against the computer, on your turn: which covered cell is most
   * likely a mine, and why. A few per match.
   */
  'ai:hint': (payload: Record<string, never>, ack: (result: AiHintResult) => void) => void;

  /** Say something in the lobby's world chat. Anyone who has picked a name. */
  'lobby:say': (payload: { text: string }, ack: (result: ModerationResult) => void) => void;
  /**
   * Post an invite card for the room you are in to the world chat. The card
   * carries a Join button; joining follows the room's normal rules.
   */
  'lobby:invite': (payload: Record<string, never>, ack: (result: ModerationResult) => void) => void;

  /** Say something in your room's chat. Players and spectators alike. */
  'room:say': (payload: { text: string }, ack: (result: ModerationResult) => void) => void;

  /** Matchmaking: join the pool for a mode, or leave it. */
  'queue:join': (payload: { mode: RoomMode }) => void;
  'queue:leave': () => void;

  /**
   * Review coach: is it available for this finished game, and how many of the
   * questions allowed per game this person has left.
   */
  'review:coach': (payload: ReviewRef, ack: (result: ReviewCoachResult) => void) => void;
  /** Ask the coach about a finished game. It answers only from the server's own record of it. */
  'review:ask': (
    payload: ReviewRef & { question: string },
    ack: (result: ReviewAskResult) => void,
  ) => void;

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

  /**
   * The replay of the match that just ended (or was forfeited): where every
   * mine was and the order the cells were opened. Sent to the room — players
   * and spectators — only AFTER the match is over, never before, since it
   * carries the mines.
   */
  'match:replay': (payload: MatchReplayNotice) => void;

  /** A friend invited you to the room they are in. Sent to each of your tabs. */
  'friend:invited': (invite: FriendInvite) => void;

  /** A line in your room's chat, from a player or the computer opponent. */
  'room:message': (message: ChatMessage) => void;

  /**
   * The language model's friendlier wording of a hint's "Why?", sent only to
   * the player who asked, a moment after the `ai:hint` answer (which already
   * carries the plain explanation as `why`). Optional by design: it never
   * comes without a Groq key, in time, or when the wording fails the server's
   * checks — and the client only swaps it in while that hint (same cell) is
   * still on screen.
   */
  'ai:hintWhy': (payload: { row: number; col: number; why: string }) => void;

  /**
   * The Fruit Fly's thought for a move, derived only from the public board and
   * broadcast to the room immediately before the bot reveals its picked cell.
   */
  'ai:flyThought': (payload: FlyThoughtNotice) => void;

  /** The world chat so far, sent once after you pick a name. Oldest first. */
  'lobby:history': (messages: LobbyMessage[]) => void;
  /** A new world-chat line or invite card. */
  'lobby:message': (message: LobbyMessage) => void;
  /** An admin cleared the world chat. */
  'lobby:cleared': () => void;

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
  /** Empties the lobby's world chat for everyone. */
  'admin:clearChat': () => void;
  /** Marks a player report resolved or dismissed (or open again). */
  'admin:report': (
    payload: { id: string; status: ReportStatus },
    ack: (result: ModerationResult) => void,
  ) => void;
}

export interface ServerToAdminEvents {
  'admin:state': (state: AdminState) => void;
  /** Terminal lines: a backfill on connect, then each new line as it happens. */
  'admin:log': (lines: LogLine[]) => void;
  /** The watched room. null once it closes or watching stops. */
  'admin:room': (view: AdminRoomView | null) => void;
  /**
   * Player reports from the last 90 days, newest first. Sent on connect and
   * whenever one arrives or changes status — separate from admin:state, which
   * goes out on every lobby change.
   */
  'admin:reports': (reports: PlayerReport[]) => void;
}
