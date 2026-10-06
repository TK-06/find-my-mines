import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { Server, type Namespace, type Socket } from 'socket.io';
import {
  ADMIN_NAMESPACE,
  AI_DEFAULT_DENSITY,
  AI_DEFAULT_SIZE,
  CLASSIC_PRESET,
  COACH_ASK_GAP_MS,
  COACH_BUSY_ERROR,
  COACH_FALLBACK_ANSWER,
  COACH_QUESTIONS_PER_GAME,
  RECONNECT_GRACE_SECONDS,
  aiBoard,
  botNickname,
  cleanChatText,
  cleanQuestion,
  describeHint,
  describeReasons,
  describeReport,
  explainHint,
  hintFor,
  isAiBoardSize,
  isAiDensity,
  isAiLevel,
  isAiModel,
  isGuestId,
  listedRooms,
  mineProbabilities,
  parseRemovalNote,
  parseReport,
  presenceOf,
  type AdminState,
  type AdminToServerEvents,
  type BotSetup,
  type ChatMessage,
  type ClientToServerEvents,
  type FriendInvite,
  type Identity,
  type JoinResult,
  type OnlinePlayer,
  type PlayerReport,
  type QueueEntry,
  type RemovalNote,
  type RemovalNotice,
  type Replay,
  type ReportParty,
  type RevealedCell,
  type RoomConfig,
  type RoomMode,
  type Seat,
  type ServerToAdminEvents,
  type ServerToClientEvents,
} from '@fmm/shared';
import { clientAddress } from './admin/access.js';
import { attachAdminNamespace } from './admin/adminNamespace.js';
import { ActivityLog } from './admin/activityLog.js';
import { attachAdminTelemetry } from './admin/telemetry.js';
import { createAdvisor } from './ai/advisor.js';
import { COACH_RESERVE, askCoach, reviewForCoach, type CoachModel, type CoachOutcome } from './ai/coach.js';
import { rewordHint } from './ai/hintReword.js';
import { createJevPicker } from './ai/jev.js';
import { BotController } from './ai/botController.js';
import { contain, respond, settleWithin } from './safety.js';
import {
  ADVERTISED_HOST,
  AI_MODEL,
  CORS_ORIGIN,
  GROQ_API_KEY,
  GROQ_COACH_API_KEY,
  HOST,
  JEV_API_KEY,
  JEV_MODEL,
  PORT,
  PUBLIC_URL,
} from './config.js';
import { MatchmakingQueue } from './matchmaking/queue.js';
import { recordMatch } from './persistence/matchRecorder.js';
import { loadReplay } from './persistence/replayLoader.js';
import { deleteOldReports, loadRecentReports, saveReport, saveReportStatus } from './persistence/reportRecorder.js';
import { ProfileLookup, previewFor, renderPreview } from './preview.js';
import { areFriends, guestIdentity, identityFromToken, profileForPreview, supabaseEnabled } from './supabase.js';
import type { FinishedMatch, MatchBroadcaster, MatchManager } from './match/matchManager.js';
import { RoomManager } from './rooms/roomManager.js';
import { ChatLimit } from './state/chatLimit.js';
import { CoachBook, type CoachTurn } from './state/coachBook.js';
import { findGame, reviewRefOf } from './state/gameLookup.js';
import { InviteLimit } from './state/inviteLimit.js';
import { LobbyChat, inviteLine, inviteRefusal, lobbyInviteLimit, playerLine } from './state/lobbyChat.js';
import { ClientRegistry } from './state/registry.js';
import { ReplayStore } from './state/replayStore.js';
import { ReportLimit } from './state/reportLimit.js';
import { REPORT_KEEP_MS, ReportStore } from './state/reportStore.js';
import { isSamePlayer } from './state/seatHold.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_STARTED_AT = Date.now();

/** How long a sign-in check may take before the player continues as a guest. */
const IDENTITY_TIMEOUT_MS = 5000;

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CORS_ORIGIN },
});

// The admin console speaks a different event vocabulary from game clients,
// so it gets its own namespace with its own typed contract.
const adminIo = io.of(ADMIN_NAMESPACE) as unknown as Namespace<
  AdminToServerEvents,
  ServerToAdminEvents
>;

/**
 * The console's terminal feed. Every line goes to open consoles; everything
 * except game traffic is also printed here, on the server's own stdout.
 */
const log = new ActivityLog((line) => {
  adminIo.emit('admin:log', [line]);
  if (line.kind !== 'traffic') {
    console.log(`  ${clock(line.at)}  ${line.kind.padEnd(10)}  ${line.text}`);
  }
});

function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

const registry = new ClientRegistry();

/**
 * Every match event is scoped to its own socket.io room, so a reveal in one
 * game is invisible to every other game on the server.
 */
const rooms = new RoomManager((roomId): MatchBroadcaster => {
  const to = () => io.to(roomId);
  const watched = () => adminConsole.roomChanged(roomId);
  return {
    matchStart: (state) => {
      to().emit('match:start', state);
      log.add('match', `${roomId} started — ${state.players.map((p) => p.nickname).join(', ')}`);
      watched();
      bots.update(roomId);
    },
    cellRevealed: (cell: RevealedCell, state) => {
      to().emit('cell:revealed', { cell, state });
      watched();
      bots.update(roomId);
    },
    turnChanged: (currentPlayerId, secondsLeft) => {
      to().emit('turn:changed', { currentPlayerId, secondsLeft });
      watched();
      bots.update(roomId);
    },
    turnTick: (secondsLeft) => {
      to().emit('turn:tick', { secondsLeft });
      watched();
    },
    matchEnded: (state, replay) => {
      to().emit('match:ended', state);
      const winner = state.players.find((p) => p.id === state.winnerId);
      const scores = state.players.map((p) => `${p.nickname} ${p.score}`).join(', ');
      log.add('match', `${roomId} ended — ${winner ? `${winner.nickname} won` : 'a draw'} (${scores})`);
      // After match:ended, never before: the replay carries the mines.
      const replayId = shareReplay(roomId, replay);
      const result = rooms.get(roomId)?.takeResult();
      if (result) {
        carryRatings(result);
        persistResult(result, replay, replayId);
      }
      watched();
      bots.update(roomId);
    },
    matchReset: (state) => {
      to().emit('match:reset', state);
      watched();
      bots.update(roomId);
    },
    stateSync: (state) => {
      to().emit('state:sync', state);
      watched();
      bots.update(roomId);
    },
    matchForfeited: (notice, result, replay) => {
      to().emit('match:forfeit', notice);
      log.add(
        'match',
        `${roomId} forfeited — ${notice.winnerNickname} won, ${notice.leaverNickname} left mid-match`,
      );
      const replayId = shareReplay(roomId, replay);
      if (result) {
        carryRatings(result);
        persistResult(result, replay, replayId);
      }
      watched();
      bots.update(roomId);
    },
    notice: (message) => to().emit('room:notice', { message }),
    error: (playerId, code, message) => io.to(playerId).emit('error:msg', { code, message }),
    changed: () => pushUpdates(),
  };
});

// ── computer opponents ──────────────────────────────────────────────────────

/**
 * Null without GROQ_API_KEY: bots then play on the solver alone. Failures are
 * logged briefly — a status, never the key or a prompt.
 */
const advisor = createAdvisor({
  apiKey: GROQ_API_KEY,
  model: AI_MODEL,
  warn: (line) => log.add('match', `AI ${line}`),
});

/**
 * Null without JEV_API_KEY: JEV then cannot be played (ai:play refuses it).
 * Same quiet logging as the advisor.
 */
const jevPicker = createJevPicker({
  apiKey: JEV_API_KEY,
  model: JEV_MODEL,
  warn: (line) => log.add('match', `AI ${line}`),
});

/** Plays every bot's turns. Fed by the room broadcasters above; told when rooms close. */
const bots = new BotController({
  room: (roomId) => rooms.get(roomId),
  advisor,
  jev: jevPicker,
  say: (roomId, bot, text) => {
    const message: ChatMessage = {
      id: randomUUID(),
      roomId,
      fromId: bot.id,
      fromName: bot.nickname,
      kind: 'bot',
      text,
      at: Date.now(),
    };
    io.to(roomId).emit('room:message', message);
  },
  report: (error) => {
    console.error('[bot] a computer move failed:', error);
    log.add('error', `a computer move failed — ${error instanceof Error ? error.message : String(error)}`);
  },
});

/**
 * A rated result changes a player's standing for the rest of their session.
 * The next room they sit in and the matchmaking pool read the rating from
 * their identity, which was loaded once at sign-in — without this, a second
 * ranked match started from the connection-time rating and saved a result
 * computed from it over the real one.
 */
function carryRatings(result: FinishedMatch): void {
  for (const player of result.players) {
    const identity = identities.get(player.clientId);
    // Guests keep the fixed starting rating; a dropped seat has no identity left.
    if (!identity || identity.isGuest) continue;
    identities.set(player.clientId, {
      ...identity,
      elo: player.eloAfter,
      gamesPlayed: identity.gamesPlayed + (result.mode === 'ranked' ? 1 : 0),
    });
  }
}

/**
 * Saves a finished or forfeited match. Ratings are already applied in memory;
 * persisting is best-effort and must never block or break the room. Each seat
 * learns the saved id, so a guest's browser can list its own games on the game
 * log.
 */
function persistResult(result: FinishedMatch, replay: Replay | null, replayId: string | null): void {
  void recordMatch(result, replay)
    .then((matchId) => {
      if (!matchId) return;
      // The coach now knows this game by both ids: one game, one allowance.
      if (replayId && replays.link(replayId, matchId)) coachBook.moveGame(replayId, matchId);
      for (const player of result.players) {
        io.to(player.clientId).emit('match:recorded', { matchId });
      }
    })
    .catch((error: unknown) => console.error('[persist] could not report the saved match:', error));
}

// ── finished games: replays and the review coach ────────────────────────────

/**
 * The replays of finished games, in memory (the last 200, for two hours), so
 * the coach works with no database at all. A game's replay is sent to its room
 * once the match is over and kept here under a random id.
 */
const replays = new ReplayStore();

/** How many questions each person has asked about each game, and the last few exchanges. Memory only. */
const coachBook = new CoachBook();

/** One question every few seconds per connection, however many games or tabs. */
const coachLimit = new ChatLimit(1, COACH_ASK_GAP_MS);

/**
 * "Is the coach on for this game?" per connection: generous for a person
 * opening reviews, but each answer can mean a database read and a whole game's
 * analysis, so a script cannot loop it over every saved match.
 */
const coachLookupLimit = new ChatLimit(10, 60_000);

/** How long the database may take to hand over a saved match's replay. */
const REPLAY_LOOKUP_TIMEOUT_MS = 5000;

/**
 * The coach's own advisor when GROQ_COACH_API_KEY is set: its own key and its
 * own per-minute budget. Without one the coach shares the main advisor, and
 * COACH_RESERVE keeps half its minute for the AI opponents. Null on both counts
 * means no coach: it is simply not offered.
 */
const coachAdvisor = createAdvisor({
  apiKey: GROQ_COACH_API_KEY,
  model: AI_MODEL,
  warn: (line) => log.add('match', `Coach ${line}`),
});
const coachModel: CoachModel | null = coachAdvisor ?? advisor;
const coachReserve = coachAdvisor ? 0 : COACH_RESERVE;

/**
 * Hands a finished match's replay to its room (players and spectators alike)
 * and keeps it for the coach. Called only once the match is over — it ended or
 * was forfeited — because the replay says where the mines were. Returns the id
 * it is kept under, or null when there was no replay.
 */
function shareReplay(roomId: string, replay: Replay | null): string | null {
  if (!replay) return null;
  const replayId = replays.add(replay, Date.now());
  io.to(roomId).emit('match:replay', {
    roomId,
    replayId,
    // Not saved yet: match:recorded tells each seat the id a moment later.
    matchId: null,
    replay,
    coach: coachModel !== null,
  });
  return replayId;
}

/**
 * Matchmaking pool.
 *
 * A paired match is auto-started: neither player chose the room, so there is no
 * meaningful host to wait on. The earliest-seated player still holds the host
 * role for anything that happens afterwards, like a rematch.
 */
const queue = new MatchmakingQueue({
  onPair: (a: QueueEntry, b: QueueEntry, mode: RoomMode) => {
    const created = rooms.create(
      `${a.nickname} vs ${b.nickname}`,
      { ...CLASSIC_PRESET, maxPlayers: 2, mode },
      'matchmaking',
    );
    if (!created.ok || !created.roomId) return null;

    const room = rooms.get(created.roomId)!;
    log.add('queue', `matched ${a.nickname} vs ${b.nickname} into ${created.roomId} (${mode})`);

    for (const entry of [a, b]) {
      const socket = io.sockets.sockets.get(entry.id);
      if (!socket) continue;

      room.addPlayer(entry.id, identityOf(entry.id));
      rooms.track(entry.id, created.roomId);
      socket.join(created.roomId);
      registry.setRoom(entry.id, created.roomId);
      registry.setSeat(entry.id, 'player');
      socket.emit('queue:status', null);
      socket.emit('queue:matched', { roomId: created.roomId });
    }

    io.to(created.roomId).emit('state:sync', room.publicState());
    if (room.hostId) room.start(room.hostId);
    return created.roomId;
  },
  onChange: () => {
    for (const row of queue.snapshot()) {
      io.to(row.id).emit('queue:status', queue.statusFor(row.id));
    }
    pushUpdates();
  },
});

// ── identity ────────────────────────────────────────────────────────────────

/** Verified identity per socket. Populated on player:join, cleared on disconnect. */
const identities = new Map<string, Identity>();

/**
 * The random id a guest's browser keeps in its fmm_guest cookie, per socket.
 * Memory only, and used for one thing: labelling a report sent by or about
 * that guest, so an admin can tell the same browser coming back.
 */
const guestIds = new Map<string, string>();

function identityOf(socketId: string): Identity {
  return identities.get(socketId) ?? guestIdentity('Player');
}

/** A readable name for logs: the nickname once known, else the socket id. */
function nameOf(socketId: string): string {
  return identities.get(socketId)?.nickname ?? socketId;
}

/**
 * Who a coach question counts against: the account when signed in, else the
 * guest id the browser keeps in its cookie, else this one connection. All of it
 * from the server's own records, never from the request.
 */
function coachPerson(socketId: string): string {
  const identity = identities.get(socketId);
  if (identity && !identity.isGuest && identity.profileId) return `account:${identity.profileId}`;
  const guestId = guestIds.get(socketId);
  return guestId ? `guest:${guestId}` : `socket:${socketId}`;
}

// ── broadcasting ────────────────────────────────────────────────────────────

function adminState(): AdminState {
  return {
    clientCount: registry.count,
    clients: registry.list(),
    rooms: rooms.list(),
    queue: queue.snapshot(),
    serverStartedAt: SERVER_STARTED_AT,
  };
}

/**
 * Who is online, as players see it. Spec: "the server will provide
 * information about the other connected client." Only clients that have
 * picked a nickname are listed, and addresses are never included.
 */
function onlinePlayers(): OnlinePlayer[] {
  return registry.list().flatMap((client) => {
    const identity = identities.get(client.id);
    if (!identity) return [];
    const room = client.roomId ? rooms.get(client.roomId) : undefined;
    // A private room's code stays with the people it was shared with: the
    // list says where someone is ("in a private room") but never which room.
    const hidden = room?.config.private === true;
    return [
      {
        id: client.id,
        nickname: identity.nickname,
        isGuest: identity.isGuest,
        status: presenceOf({
          inQueue: queue.has(client.id),
          roomId: client.roomId,
          seat: client.seat,
          roomStatus: room?.summary().status ?? null,
        }),
        roomId: hidden ? null : client.roomId,
        ...(hidden ? { privateRoom: true } : {}),
        profileId: identity.profileId,
        // Only accounts with a picture carry one; a guest's row is unchanged.
        ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
      },
    ];
  });
}

/** What players see. Private rooms are left out; the console (adminState) lists every room. */
function lobbyPayload() {
  return { rooms: listedRooms(rooms.list()), clientCount: registry.count, online: onlinePlayers() };
}

/** Refresh the landing page, the online list and the server console together. */
function pushUpdates(): void {
  io.emit('lobby:rooms', lobbyPayload());
  adminConsole.pushState();
  adminConsole.allRoomsChanged();
  printConsole();
}

/**
 * The server's own stdout display.
 *
 * The graphical console lives at /admin, but the assignment asks for the
 * *server program* to display the connected-client count and list, so it is
 * printed here too — visible in the terminal running the server.
 */
function printConsole(): void {
  const roomList = rooms.list();
  const lines = [
    '',
    '─── Find My Mines — server ────────────────────────────────',
    `  Clients online: ${registry.count}`,
    ...registry.list().map((c, i) => {
      const where = c.roomId ? `room ${c.roomId}` : 'lobby';
      return `   ${i + 1}. ${c.nickname}  [${c.seat}]  ${where}  ${c.address}`;
    }),
    `  Rooms: ${roomList.length}`,
    ...roomList.map(
      (r) =>
        `   • ${r.id} "${r.name}"  ${r.status}  ` +
        `${r.playerCount}/${r.config.maxPlayers ?? '∞'} players, ${r.spectatorCount} watching  ` +
        `${r.config.rows}x${r.config.cols}, ${r.config.mineCount} mines`,
    ),
    `  Matchmaking pool: ${queue.size}`,
    ...queue.snapshot().map(
      (q) =>
        `   • ${q.nickname}  ${q.elo} Elo  ${q.mode}  ` +
        `waiting ${Math.round(q.waitedMs / 1000)}s (±${q.eloWindow})`,
    ),
    '───────────────────────────────────────────────────────────',
  ];
  console.log(lines.join('\n'));
}

/** Moves a socket out of its current room, closing that room if it emptied. */
function leaveCurrentRoom(socket: { id: string; leave: (room: string) => void }): void {
  const current = rooms.roomOf(socket.id);
  if (!current) return;
  const roomName = current.roomName;

  // Leave the socket.io room BEFORE the match reacts to the departure. The
  // room's final state:sync would otherwise still reach the leaver and pull
  // their client back onto a room they already left.
  socket.leave(current.roomId);
  const { roomId, closed } = rooms.leave(socket.id);
  if (!roomId) return;

  registry.setRoom(socket.id, null);
  registry.setSeat(socket.id, 'spectator');
  log.add('room', `${nameOf(socket.id)} left ${roomId}${closed ? ' — room closed, nobody left' : ''}`);

  if (closed) {
    io.to(roomId).emit('room:closed', { roomId, reason: 'Everyone left the room.' });
    closeRequestsFor(roomId, roomName);
    bots.forget(roomId);
    adminConsole.roomChanged(roomId);
  }
}

/**
 * Seats a socket in a room — the one path for joining, spectating, and being
 * let in by a host. Leaves any other room, queue or pending request first.
 */
function seatInRoom(socket: GameSocket, room: MatchManager, asSpectator: boolean): Seat {
  withdrawRequest(socket.id);
  queue.leave(socket.id);
  leaveCurrentRoom(socket);

  const identity = identityOf(socket.id);
  const seat = asSpectator
    ? room.addSpectator(socket.id, identity)
    : room.addPlayer(socket.id, identity);

  rooms.track(socket.id, room.roomId);
  socket.join(room.roomId);
  registry.setRoom(socket.id, room.roomId);
  registry.setSeat(socket.id, seat);
  log.add('room', `${nameOf(socket.id)} joined ${room.roomId} as ${seat}`);

  // Everyone already in the room needs the new roster too, not just the
  // arriving client — otherwise player and spectator counts go stale.
  io.to(room.roomId).emit('state:sync', room.publicState());
  pushUpdates();
  return seat;
}

// ── join requests ───────────────────────────────────────────────────────────

/** Who is waiting on which ask-to-join room. One pending request per client. */
const pendingRequests = new Map<string, string>();

/** Withdraws a client's pending request, if any. True when there was one. */
function withdrawRequest(clientId: string): boolean {
  const roomId = pendingRequests.get(clientId);
  if (!roomId) return false;
  pendingRequests.delete(clientId);
  rooms.get(roomId)?.withdrawRequest(clientId);
  return true;
}

/** A room is gone: nobody should keep waiting on it. */
function closeRequestsFor(roomId: string, roomName: string): void {
  for (const [clientId, pendingRoomId] of pendingRequests) {
    if (pendingRoomId !== roomId) continue;
    pendingRequests.delete(clientId);
    io.to(clientId).emit('room:requestResolved', {
      roomId,
      roomName,
      outcome: 'closed',
      byName: null,
    });
  }
}

// ── friend invites ──────────────────────────────────────────────────────────

/** How long the friendship check may take before the invite is refused. */
const FRIEND_CHECK_TIMEOUT_MS = 5000;

/** One invite per player → friend every few seconds, however fast they click. */
const inviteLimit = new InviteLimit();

/** A few chat lines per connection every few seconds, so nobody floods a room. */
const chatLimit = new ChatLimit();

/**
 * The lobby's world chat: the last few dozen lines, in memory only. Its own
 * allowance, so talking in a room does not use up the world chat's, and one
 * invite card per tab every half minute. Both are keyed by the tab's session id
 * (the socket id without one) and kept past a disconnect, so a reload does not
 * reset them; ChatLimit drops a key by itself once its window has passed.
 */
const lobbyChat = new LobbyChat();
const lobbyChatLimit = new ChatLimit();

/** Player reports for the console: newest first, the last 90 days. */
const reports = new ReportStore();
const reportLimit = new ReportLimit();

/** One side of a report, from the server's own records. Null for a client with no name yet. */
function partyOf(socketId: string): ReportParty | null {
  const identity = identities.get(socketId);
  const client = registry.get(socketId);
  if (!identity || !client) return null;
  const socket = io.sockets.sockets.get(socketId);
  return {
    nickname: identity.nickname,
    profileId: identity.isGuest ? null : identity.profileId,
    isGuest: identity.isGuest,
    guestId: guestIds.get(socketId) ?? null,
    sessionId: socket ? sessionIdOf(socket) : null,
    address: client.address,
  };
}

/** Who someone is for the report limits: an account beats a guest id beats a tab. */
function reportKey(party: ReportParty, socketId: string): string {
  if (party.profileId) return `account:${party.profileId}`;
  if (party.guestId) return `guest:${party.guestId}`;
  if (party.sessionId) return `tab:${party.sessionId}`;
  return `socket:${socketId}`;
}

/**
 * Reports older than 90 days go, from memory and the database: at start-up
 * (after loading what the database kept) and then once a day.
 */
async function loadAndPruneReports(): Promise<void> {
  await deleteOldReports();
  reports.addAll(await loadRecentReports());
  reports.prune(Date.now(), REPORT_KEEP_MS);
  adminConsole.reportsChanged();
}
setInterval(
  contain(
    () => {
      reports.prune(Date.now(), REPORT_KEEP_MS);
      void deleteOldReports();
      adminConsole.reportsChanged();
    },
    (error) => console.error('[reports] daily prune failed:', error),
  ),
  24 * 60 * 60 * 1000,
).unref();
const lobbyInvites = lobbyInviteLimit();

/** Every connected socket signed in as this account — one per open tab. */
function socketsOfProfile(profileId: string): string[] {
  if (!profileId) return [];
  const found: string[] = [];
  for (const [socketId, identity] of identities) {
    if (identity.profileId === profileId) found.push(socketId);
  }
  return found;
}

// ── held seats (reconnect grace period) ─────────────────────────────────────

interface HeldSeat {
  /** The dropped connection's id — still the seat's id inside the room. */
  socketId: string;
  roomId: string;
  /** Whose seat it is, so only the same player can take it back. */
  profileId: string | null;
  nickname: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Seats held for players whose connection dropped, keyed by the per-tab
 * session id the client sends in its handshake. A reconnect with the same id
 * inside the grace window takes the seat back; otherwise the timer runs the
 * normal leave (a forfeit, mid-match).
 */
const heldSeats = new Map<string, HeldSeat>();

function sessionIdOf(socket: { handshake: { auth?: Record<string, unknown> } }): string | null {
  const id = socket.handshake.auth?.sessionId;
  return typeof id === 'string' && id.length >= 16 && id.length <= 64 ? id : null;
}

/** The session holding a seat for this dropped connection, if any. */
function heldSessionOf(socketId: string): string | undefined {
  for (const [sessionId, held] of heldSeats) {
    if (held.socketId === socketId) return sessionId;
  }
  return undefined;
}

/** A seated player's connection dropped: keep their seat for the grace period. */
function holdSeat(sessionId: string, socketId: string, room: MatchManager): void {
  // One held seat per tab. An older one is given up rather than left stranded.
  releaseHeldSeat(sessionId, 'the same tab dropped again');

  const identity = identityOf(socketId);
  heldSeats.set(sessionId, {
    socketId,
    roomId: room.roomId,
    profileId: identity.profileId,
    nickname: identity.nickname,
    // Runs outside any socket handler, so it contains its own failures.
    timer: setTimeout(
      contain(
        () => releaseHeldSeat(sessionId, `did not come back within ${RECONNECT_GRACE_SECONDS}s`),
        (error) => console.error('[reconnect] could not release a held seat:', error),
      ),
      RECONNECT_GRACE_SECONDS * 1000,
    ),
  });
  room.markDisconnected(socketId);
  log.add('room', `${identity.nickname} dropped from ${room.roomId} — seat held ${RECONNECT_GRACE_SECONDS}s`);
}

/**
 * Gives up a held seat now: the normal leave runs for the dropped connection,
 * which mid-match is a forfeit.
 */
function releaseHeldSeat(sessionId: string, why: string): void {
  const held = heldSeats.get(sessionId);
  if (!held) return;

  clearTimeout(held.timer);
  heldSeats.delete(sessionId);
  log.add('room', `${held.nickname}'s seat in ${held.roomId} released — ${why}`);
  // The dropped socket is gone, so there is no socket.io room left to leave.
  leaveCurrentRoom({ id: held.socketId, leave: () => undefined });
  pushUpdates();
}

/** A room is gone: nothing in it is worth holding a seat for. */
function forgetHeldSeatsIn(roomId: string): void {
  for (const [sessionId, held] of heldSeats) {
    if (held.roomId !== roomId) continue;
    clearTimeout(held.timer);
    heldSeats.delete(sessionId);
  }
}

/**
 * Takes back the seat held for this tab — but only for the same player. A tab
 * that comes back as someone else (a guest who signed in, say) gives the seat
 * up instead of inheriting another player's score and rating.
 */
function resumeHeldSeat(
  socket: GameSocket,
  sessionId: string | null,
  identity: Identity,
): MatchManager | null {
  const held = sessionId ? heldSeats.get(sessionId) : undefined;
  if (!held || !sessionId) return null;

  if (!isSamePlayer(held, identity)) {
    releaseHeldSeat(sessionId, `the tab came back as ${identity.nickname}`);
    return null;
  }

  clearTimeout(held.timer);
  heldSeats.delete(sessionId);

  const room = rooms.get(held.roomId);
  if (!room || !room.rebind(held.socketId, socket.id)) return null;

  rooms.retrack(held.socketId, socket.id);
  socket.join(room.roomId);
  registry.setRoom(socket.id, room.roomId);
  registry.setSeat(socket.id, 'player');
  log.add('room', `${identity.nickname} took back their seat in ${room.roomId}`);
  return room;
}

/**
 * Takes a game client out of its room and the matchmaking queue, then tells it
 * why. It stays connected; the caller decides whether to disconnect it.
 */
function removeClient(clientId: string, notice: RemovalNotice): GameSocket | undefined {
  const socket = io.sockets.sockets.get(clientId);
  if (!socket) {
    // Their connection already dropped and the seat is being held: give it up
    // now. There is nobody to tell — if they come back, they land in the lobby.
    const held = heldSessionOf(clientId);
    if (held) releaseHeldSeat(held, `${notice.kind} by the ${notice.by} while away`);
    return undefined;
  }

  withdrawRequest(clientId);
  queue.leave(clientId);
  leaveCurrentRoom(socket);
  socket.emit('player:removed', notice);
  pushUpdates();
  return socket;
}

/** The payload of a client event for the traffic log. Ack callbacks are dropped. */
function describeArgs(args: unknown[]): string {
  const data = args.filter((arg) => typeof arg !== 'function');
  if (data.length === 0) return '';
  const text = JSON.stringify(data.length === 1 ? data[0] : data) ?? '';
  return ` ${text.length > 160 ? `${text.slice(0, 157)}...` : text}`;
}

// ── admin namespace (the server console) ────────────────────────────────────

const adminConsole = attachAdminNamespace({
  adminIo,
  rooms,
  log,
  state: adminState,
  // A player whose seat is being held still counts: kicking them gives it up.
  isConnected: (clientId) =>
    io.sockets.sockets.has(clientId) || heldSessionOf(clientId) !== undefined,

  kick: (clientId: string, note: RemovalNote) => {
    const roomId = rooms.roomIdOf(clientId);
    log.add(
      'moderation',
      `admin kicked ${nameOf(clientId)}${roomId ? ` from ${roomId}` : ''} — ${describeReasons(note)}`,
    );
    removeClient(clientId, {
      kind: 'kicked',
      by: 'admin',
      byName: null,
      roomId,
      roomName: roomId ? (rooms.get(roomId)?.roomName ?? null) : null,
      roomBan: false,
      note,
    });
  },

  ban: (clientId: string, note: RemovalNote) => {
    const roomId = rooms.roomIdOf(clientId);
    log.add('moderation', `admin banned ${nameOf(clientId)} — ${describeReasons(note)}`);
    const socket = removeClient(clientId, {
      kind: 'banned',
      by: 'admin',
      byName: null,
      roomId,
      roomName: roomId ? (rooms.get(roomId)?.roomName ?? null) : null,
      roomBan: false,
      note,
    });
    // A server-side disconnect: the client does not auto-reconnect. The notice
    // was queued first on the same connection, so it arrives before this.
    socket?.disconnect();
  },

  closeRoom: (roomId: string, note: RemovalNote) => {
    const room = rooms.get(roomId);
    if (!room) return false;

    const roomName = room.roomName;
    const members = rooms.close(roomId);
    log.add(
      'moderation',
      `admin ended ${roomId} "${roomName}" with ${members.length} inside — ${describeReasons(note)}`,
    );

    for (const id of members) {
      const socket = io.sockets.sockets.get(id);
      if (!socket) continue;
      socket.leave(roomId);
      registry.setRoom(id, null);
      registry.setSeat(id, 'spectator');
      socket.emit('player:removed', {
        kind: 'room-closed',
        by: 'admin',
        byName: null,
        roomId,
        roomName,
        roomBan: false,
        note,
      });
    }

    closeRequestsFor(roomId, roomName);
    forgetHeldSeatsIn(roomId);
    bots.forget(roomId);
    adminConsole.roomChanged(roomId);
    pushUpdates();
    return true;
  },

  reset: (roomId?: string) => {
    rooms.reset(roomId);
    pushUpdates();
  },

  reports: () => reports.list(),

  setReportStatus: (id, status) => {
    const changed = reports.setStatus(id, status, Date.now());
    if (!changed) return false;
    void saveReportStatus(id, changed.status, changed.handledAt);
    log.add('moderation', `admin marked the report on ${changed.target.nickname} ${status}`);
    adminConsole.reportsChanged();
    return true;
  },

  // The world chat lives only in this process's memory, so emptying it here
  // empties it for good; every open lobby is told to empty its copy too.
  clearChat: () => {
    const removed = lobbyChat.clear();
    io.emit('lobby:cleared');
    log.add('moderation', `admin cleared the world chat — ${removed} line${removed === 1 ? '' : 's'} removed`);
  },
});
attachAdminTelemetry(adminIo);

// ── containing failures ─────────────────────────────────────────────────────

const SERVER_ERROR = 'The server could not handle that request.';

/**
 * A handler failed. The process stays up, the console says what happened, and
 * a client waiting for a reply gets one — `ok: false` with a message is
 * understood by every acknowledgement in the protocol.
 */
function handlerFailed(clientId: string, event: string, error: unknown, args: unknown[]): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[handler] ${event} from ${clientId} failed:`, error);
  log.add('error', `${event} from ${nameOf(clientId)} failed — ${message}`);
  respond(args.at(-1), { ok: false, error: SERVER_ERROR, errors: [SERVER_ERROR] });
}

/**
 * socket.on, with the handler's failures contained to that one event. Every
 * game event goes through here: anything on the network can send anything,
 * and one malformed message must never end every match on the server.
 */
function listen<E extends keyof ClientToServerEvents>(
  socket: GameSocket,
  event: E,
  handler: ClientToServerEvents[E],
): void {
  socket.on(
    event,
    contain(handler as (...args: unknown[]) => unknown, (error, args) =>
      handlerFailed(socket.id, event, error, args),
    ) as never,
  );
}

/** A string field from an untrusted payload, or '' when it is missing or not a string. */
function text(payload: unknown, field: string): string {
  const value = (payload as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === 'string' ? value : '';
}

// ── game namespace ──────────────────────────────────────────────────────────

io.on('connection', contain((socket: GameSocket) => {
  // Through the Cloudflare tunnel every peer is 127.0.0.1; the visitor's own
  // address comes from the tunnel's header (see clientAddress).
  const address = clientAddress(socket.handshake.address, socket.handshake.headers);
  registry.add(socket.id, address);
  log.add('connection', `connect ${socket.id} from ${address} via ${socket.conn.transport.name}`);

  // Every event this client sends, for the console's "Show game traffic" view.
  socket.onAny(
    contain(
      (event: string, ...args: unknown[]) => {
        log.add('traffic', `← ${nameOf(socket.id)}  ${event}${describeArgs(args)}`);
      },
      (error) => console.error('[traffic] could not log an event:', error),
    ),
  );

  pushUpdates();

  socket.emit('lobby:rooms', lobbyPayload());

  const sessionId = sessionIdOf(socket);

  listen(socket, 'player:join', async (payload, ack) => {
    const clean = text(payload, 'nickname').trim().slice(0, 20) || 'Player';

    // The access token comes from the handshake, and the server verifies it
    // against Supabase. Nothing the client says about its own identity is
    // trusted — no token simply means guest. A slow or unreachable database
    // must never leave a player on "Connecting…": after a few seconds they
    // continue as a guest.
    const token = socket.handshake.auth?.accessToken;
    const identity = await settleWithin(
      identityFromToken(typeof token === 'string' ? token : undefined, clean),
      IDENTITY_TIMEOUT_MS,
      guestIdentity(clean),
    );
    // They may have left while the database answered.
    if (socket.disconnected) return;
    identities.set(socket.id, identity);
    const guestId = (payload as { guestId?: unknown } | null | undefined)?.guestId;
    if (identity.isGuest && isGuestId(guestId)) guestIds.set(socket.id, guestId);
    else guestIds.delete(socket.id);

    registry.setIdentity(socket.id, identity.nickname, identity.isGuest);
    log.add(
      'player',
      `${socket.id} is "${identity.nickname}" (${identity.isGuest ? 'guest' : 'account'})`,
    );

    const resumed = resumeHeldSeat(socket, sessionId, identity);

    const result: JoinResult = {
      ok: true,
      playerId: socket.id,
      // Spec: "a welcome message with their nickname will appear".
      welcome: `Welcome, ${identity.nickname}.`,
      isGuest: identity.isGuest,
      elo: identity.elo,
      roomId: resumed?.roomId,
    };
    respond(ack, result);
    // After the ack, so the client already knows which room this is for.
    if (resumed) socket.emit('state:sync', resumed.publicState());
    // The world chat so far, now that they have a name to talk under.
    socket.emit('lobby:history', lobbyChat.history());
    pushUpdates();
  });

  listen(socket, 'room:create', (payload, ack) => {
    // coerceRoomConfig accepts any object and validation rejects bad values;
    // anything that is not an object at all falls back to Classic.
    const rawConfig = (payload as { config?: unknown } | null | undefined)?.config;
    const created = rooms.create(
      text(payload, 'name'),
      typeof rawConfig === 'object' && rawConfig !== null ? (rawConfig as Partial<RoomConfig>) : undefined,
    );
    if (!created.ok || !created.roomId) {
      respond(ack, { ok: false, errors: created.errors ?? ['Could not create the room.'] });
      return;
    }

    withdrawRequest(socket.id);
    queue.leave(socket.id);
    leaveCurrentRoom(socket);

    const room = rooms.get(created.roomId)!;
    const seat = room.addPlayer(socket.id, identityOf(socket.id));

    rooms.track(socket.id, created.roomId);
    socket.join(created.roomId);
    registry.setRoom(socket.id, created.roomId);
    registry.setSeat(socket.id, seat);

    const c = room.config;
    log.add(
      'room',
      `${nameOf(socket.id)} created ${room.roomId} "${room.roomName}" ` +
        `(${c.rows}×${c.cols}, ${c.mineCount} mines, ${c.mode})`,
    );

    respond(ack, { ok: true, roomId: created.roomId, seat });
    io.to(created.roomId).emit('state:sync', room.publicState());
    pushUpdates();
  });

  const enterRoom = (roomId: string, asSpectator: boolean, ack: unknown) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) {
      respond(ack, { ok: false, errors: ['That room no longer exists.'] });
      return;
    }

    if (room.isBannedFromRoom(socket.id, identityOf(socket.id))) {
      respond(ack, { ok: false, errors: ['The host has banned you from this room.'] });
      return;
    }

    // An ask-to-join room seats players only through the host's approval, so
    // a client cannot skip it by sending room:join. Watching stays open.
    if (!asSpectator && room.config.joinByRequest === true) {
      respond(ack, { ok: false, errors: ['This room asks to join — send the host a request.'] });
      return;
    }

    const seat = seatInRoom(socket, room, asSpectator);
    respond(ack, { ok: true, roomId: room.roomId, seat });
  };

  listen(socket, 'room:join', (payload, ack) => enterRoom(text(payload, 'roomId'), false, ack));
  listen(socket, 'room:spectate', (payload, ack) => enterRoom(text(payload, 'roomId'), true, ack));

  // By code, private rooms included: whoever has the code may join anyway, so
  // its summary tells them nothing new — it only lets the client choose
  // between joining and asking the host.
  listen(socket, 'room:lookup', (payload, ack) => {
    const room = rooms.get(text(payload, 'roomId').trim().toUpperCase());
    if (!room) {
      respond(ack, { ok: false, error: 'That room no longer exists.' });
      return;
    }
    respond(ack, { ok: true, room: room.summary() });
  });

  listen(socket, 'room:leave', () => {
    leaveCurrentRoom(socket);
    socket.emit('lobby:rooms', lobbyPayload());
    pushUpdates();
  });

  listen(socket, 'room:requestJoin', (payload, ack) => {
    const room = rooms.get(text(payload, 'roomId').toUpperCase());
    if (!room) {
      respond(ack, { ok: false, error: 'That room no longer exists.' });
      return;
    }

    // One pending request at a time: asking here withdraws one elsewhere.
    if (pendingRequests.get(socket.id) !== room.roomId) withdrawRequest(socket.id);

    const refusal = room.requestJoin(socket.id, identityOf(socket.id));
    if (refusal) {
      respond(ack, { ok: false, error: refusal });
      return;
    }

    pendingRequests.set(socket.id, room.roomId);
    log.add('room', `${nameOf(socket.id)} asked to join ${room.roomId}`);
    respond(ack, { ok: true });
  });

  listen(socket, 'room:cancelRequest', () => {
    if (withdrawRequest(socket.id)) log.add('room', `${nameOf(socket.id)} withdrew their request`);
  });

  listen(socket, 'room:answerRequest', (payload, ack) => {
    const room = rooms.roomOf(socket.id);
    if (!room) {
      respond(ack, { ok: false, error: 'You are not in a room.' });
      return;
    }

    const requesterId = text(payload, 'requesterId');
    const taken = room.takeRequest(socket.id, requesterId);
    if ('error' in taken) {
      respond(ack, { ok: false, error: taken.error });
      return;
    }
    pendingRequests.delete(requesterId);

    const accept = payload?.accept === true;
    const hostName = nameOf(socket.id);
    log.add('room', `host ${hostName} ${accept ? 'let in' : 'declined'} ${nameOf(requesterId)} (${room.roomId})`);

    const requester = io.sockets.sockets.get(requesterId);
    if (requester) {
      // The answer goes first: the client only follows a room it knows it is
      // in, so it must adopt this one before seatInRoom's state:sync arrives.
      requester.emit('room:requestResolved', {
        roomId: room.roomId,
        roomName: room.roomName,
        outcome: accept ? 'accepted' : 'declined',
        byName: hostName,
      });
      if (accept) seatInRoom(requester, room, false);
    }
    respond(ack, { ok: true });
  });

  // Host-only kick or ban. Every rule — host, casual, created by a player, in
  // the room, not yourself — is checked here, whatever the client showed.
  listen(socket, 'room:kick', (payload, ack) => {
    const room = rooms.roomOf(socket.id);
    if (!room) {
      respond(ack, { ok: false, error: 'You are not in a room.' });
      return;
    }

    const targetId = text(payload, 'targetId');
    const refusal = room.moderationError(socket.id, targetId);
    if (refusal) {
      respond(ack, { ok: false, error: refusal });
      return;
    }

    const parsed = parseRemovalNote(payload?.note);
    if (!parsed.ok) {
      respond(ack, { ok: false, error: parsed.error });
      return;
    }

    const ban = payload?.ban === true;
    if (ban) room.banFromRoom(targetId);
    log.add(
      'moderation',
      `host ${nameOf(socket.id)} ${ban ? 'banned' : 'kicked'} ${nameOf(targetId)} ` +
        `from ${room.roomId} — ${describeReasons(parsed.note)}`,
    );

    removeClient(targetId, {
      kind: 'kicked',
      by: 'host',
      byName: nameOf(socket.id),
      roomId: room.roomId,
      roomName: room.roomName,
      roomBan: ban,
      note: parsed.note,
    });
    respond(ack, { ok: true });
  });

  // Signed-in players only. The friendship is read from the database with the
  // service role — a client saying "we are friends" is never enough.
  listen(socket, 'friend:invite', async (payload, ack) => {
    const sender = identities.get(socket.id);
    if (!sender?.profileId || sender.isGuest) {
      respond(ack, { ok: false, error: 'Sign in to invite friends.' });
      return;
    }
    const fromId = sender.profileId;
    if (!rooms.roomOf(socket.id)) {
      respond(ack, { ok: false, error: 'Join or create a room first.' });
      return;
    }

    const targetId = text(payload, 'profileId');
    if (targetId === fromId) {
      respond(ack, { ok: false, error: 'You cannot invite yourself.' });
      return;
    }
    if (socketsOfProfile(targetId).length === 0) {
      respond(ack, { ok: false, error: 'They are not online right now.' });
      return;
    }

    const friends = await settleWithin(
      areFriends(fromId, targetId),
      FRIEND_CHECK_TIMEOUT_MS,
      false,
    );
    if (socket.disconnected) return;
    if (!friends) {
      respond(ack, { ok: false, error: 'You can only invite friends.' });
      return;
    }

    // The database took a moment: the sender may have left their room, or
    // the friend closed their last tab, in the meantime.
    const room = rooms.roomOf(socket.id);
    const targets = socketsOfProfile(targetId);
    if (!room) {
      respond(ack, { ok: false, error: 'Join or create a room first.' });
      return;
    }
    if (targets.length === 0) {
      respond(ack, { ok: false, error: 'They are not online right now.' });
      return;
    }

    const wait = inviteLimit.tryInvite(fromId, targetId, Date.now());
    if (wait > 0) {
      respond(ack, {
        ok: false,
        error: `You just invited them — try again in ${Math.ceil(wait / 1000)} s.`,
      });
      return;
    }

    const invite: FriendInvite = {
      id: randomUUID(),
      fromName: sender.nickname,
      fromProfileId: fromId,
      roomId: room.roomId,
      roomName: room.roomName,
      sentAt: Date.now(),
    };
    // Every tab they have open, so the popup is wherever they are looking.
    io.to(targets).emit('friend:invited', invite);
    log.add('room', `${sender.nickname} invited ${nameOf(targets[0])} to ${room.roomId}`);
    respond(ack, { ok: true });
  });

  // Play vs AI: a fresh casual room on the board the player picked (Classic's
  // 6x6 and mine density unless they say otherwise) with the player seated,
  // then a computer opponent, started at once. The player joined first, so
  // they are the host. Never rated; spectators may still watch.
  listen(socket, 'ai:play', (payload, ack) => {
    const level: unknown = payload?.level;
    const model: unknown = payload?.model;
    const size: unknown = payload?.size ?? AI_DEFAULT_SIZE;
    const density: unknown = payload?.density ?? AI_DEFAULT_DENSITY;
    const refuse = (error: string) => respond(ack, { ok: false, errors: [error] });

    if (!isAiLevel(level)) return refuse('Pick easy, medium or hard.');
    if (!isAiModel(model)) return refuse('Pick AI or the Fruit Fly.');
    if (model === 'jev' && !jevPicker) return refuse("JEV isn't set up on this server.");
    if (!isAiBoardSize(size)) return refuse('Pick a board size from 6×6 to 16×16.');
    if (!isAiDensity(density)) return refuse('Pick light, classic or heavy mines.');
    const setup: BotSetup = { level, model };

    const identity = identityOf(socket.id);
    const created = rooms.create(
      `${identity.nickname} vs ${botNickname(setup)}`,
      { ...CLASSIC_PRESET, ...aiBoard(size, density), maxPlayers: 2, mode: 'casual' },
      'ai',
    );
    if (!created.ok || !created.roomId) {
      respond(ack, { ok: false, errors: created.errors ?? ['Could not start a game against the computer.'] });
      return;
    }

    withdrawRequest(socket.id);
    queue.leave(socket.id);
    leaveCurrentRoom(socket);

    const room = rooms.get(created.roomId)!;
    const seat = room.addPlayer(socket.id, identity);
    rooms.track(socket.id, room.roomId);
    socket.join(room.roomId);
    registry.setRoom(socket.id, room.roomId);
    registry.setSeat(socket.id, seat);

    if (!rooms.addBot(room.roomId, setup)) {
      // Cannot happen in a fresh two-seat room; if it ever does, leave nothing behind.
      leaveCurrentRoom(socket);
      respond(ack, { ok: false, errors: ['Could not start a game against the computer.'] });
      pushUpdates();
      return;
    }
    bots.adopt(room.roomId);
    log.add('room', `${nameOf(socket.id)} started ${room.roomId} "${room.roomName}" against the computer`);

    // The ack first: the client only follows a room it adopted, so it must
    // know this one before the room's first state:sync — or the bot's first line.
    respond(ack, { ok: true, roomId: room.roomId, seat });
    io.to(room.roomId).emit('state:sync', room.publicState());
    room.start(socket.id);
    pushUpdates();
  });

  // What the AI opponent is made of, for the picker's "about" panel: whether a
  // language model is behind it and which. Only what the server already
  // advertises in its banner — never the key.
  listen(socket, 'ai:about', (_payload, ack) => {
    respond(ack, {
      llm: advisor ? { provider: 'Groq', model: advisor.model } : null,
      jev: jevPicker ? { provider: 'TypeSafe AI', model: jevPicker.model } : null,
    });
  });

  // A hint in a game against the computer: the covered cell the solver thinks
  // most likely a mine, worked out from the public board — never from the
  // mine positions. Refusals carry the count too, so the button stays honest.
  // The answer carries a plain "why" from the same public board; the language
  // model's friendlier wording, when there is one, follows as ai:hintWhy.
  listen(socket, 'ai:hint', (_payload, ack) => {
    const room = rooms.roomOf(socket.id);
    if (!room) {
      respond(ack, { ok: false, error: 'You are not in a room.' });
      return;
    }

    const hintsLeft =
      room.origin === 'ai' && room.isSeated(socket.id) ? room.hintsLeft(socket.id) : undefined;
    const refusal = room.hintRefusal(socket.id);
    if (refusal) {
      respond(ack, { ok: false, error: refusal, hintsLeft });
      return;
    }

    const state = room.publicState();
    const view = { rows: state.rows, cols: state.cols, mineCount: state.bombCount, revealed: state.revealed };
    const grid = mineProbabilities(view);
    const hint = hintFor(grid);
    if (!hint) {
      respond(ack, { ok: false, error: 'There is nothing left to uncover.', hintsLeft });
      return;
    }

    const why = explainHint(view, grid, hint, 'mine');
    const left = room.spendHint(socket.id);
    respond(ack, {
      ok: true,
      row: hint.row,
      col: hint.col,
      text: describeHint(hint),
      why: why.text,
      hintsLeft: left,
    });

    // After the answer, and without anyone waiting: it only ever adds to it.
    void rewordHint(
      {
        advisor,
        // Only while this player is still seated in this same room, in this same match.
        look: () => {
          if (rooms.roomOf(socket.id) !== room || !room.isSeated(socket.id)) return null;
          const now = room.publicState();
          return {
            matchNumber: room.matchNumber,
            hintsLeft: room.hintsLeft(socket.id),
            playing: now.status === 'playing',
            covered: !now.revealed.some((cell) => cell.row === hint.row && cell.col === hint.col),
          };
        },
        send: (payload) => socket.emit('ai:hintWhy', payload),
      },
      {
        row: hint.row,
        col: hint.col,
        reason: why.reason,
        plain: why.text,
        stamp: { matchNumber: room.matchNumber, hintsLeft: left },
      },
    );
  });

  // Room chat, players and spectators alike. Nothing is stored: a line goes to
  // whoever is in the room right now — the sender included, whose client shows
  // its own line when the server echoes it.
  listen(socket, 'room:say', (payload, ack) => {
    const room = rooms.roomOf(socket.id);
    if (!room) {
      respond(ack, { ok: false, error: 'Join a room to chat.' });
      return;
    }

    const clean = cleanChatText(payload?.text);
    if (!clean) {
      respond(ack, { ok: false, error: 'Type something to send.' });
      return;
    }

    const wait = chatLimit.trySend(socket.id, Date.now());
    if (wait > 0) {
      respond(ack, {
        ok: false,
        error: `Slow down — you can send again in ${Math.ceil(wait / 1000)} s.`,
      });
      return;
    }

    const sender = identityOf(socket.id);
    const message: ChatMessage = {
      id: randomUUID(),
      roomId: room.roomId,
      fromId: socket.id,
      fromName: sender.nickname,
      kind: 'player',
      text: clean,
      at: Date.now(),
      // From the verified identity, like the name — never from the payload.
      ...(sender.avatarUrl ? { fromAvatarUrl: sender.avatarUrl } : {}),
    };
    io.to(room.roomId).emit('room:message', message);
    respond(ack, { ok: true });
  });

  // The lobby's world chat: anyone who has picked a name, guests included.
  // Lines go to every connection, and the last few dozen stay in memory for
  // whoever arrives next. Nothing reaches the database.
  listen(socket, 'lobby:say', (payload, ack) => {
    const sender = identities.get(socket.id);
    if (!sender) {
      respond(ack, { ok: false, error: 'Pick a name first.' });
      return;
    }

    const clean = cleanChatText(payload?.text);
    if (!clean) {
      respond(ack, { ok: false, error: 'Type something to send.' });
      return;
    }

    const wait = lobbyChatLimit.trySend(sessionId ?? socket.id, Date.now());
    if (wait > 0) {
      respond(ack, {
        ok: false,
        error: `Slow down — you can send again in ${Math.ceil(wait / 1000)} s.`,
      });
      return;
    }

    const message = playerLine({ id: randomUUID(), fromId: socket.id, sender, at: Date.now() }, clean);
    lobbyChat.add(message);
    io.emit('lobby:message', message);
    respond(ack, { ok: true });
  });

  // An invite card for the room you are playing in, with a Join button for
  // everyone in the lobby. Joining from it follows the room's normal rules —
  // the card is an advert, not a way past ask-to-join or a ban.
  listen(socket, 'lobby:invite', (_payload, ack) => {
    const sender = identities.get(socket.id);
    if (!sender) {
      respond(ack, { ok: false, error: 'Pick a name first.' });
      return;
    }

    const room = rooms.roomOf(socket.id);
    const refusal = inviteRefusal({
      room: room ? room.summary() : null,
      seated: room?.isSeated(socket.id) ?? false,
      isHost: room?.hostId === socket.id,
    });
    if (refusal || !room) {
      respond(ack, { ok: false, error: refusal ?? 'Join or create a room first.' });
      return;
    }

    const wait = lobbyInvites.trySend(sessionId ?? socket.id, Date.now());
    if (wait > 0) {
      respond(ack, {
        ok: false,
        error: `You just posted an invite — try again in ${Math.ceil(wait / 1000)} s.`,
      });
      return;
    }

    const message = inviteLine(
      { id: randomUUID(), fromId: socket.id, sender, at: Date.now() },
      room.summary(),
    );
    lobbyChat.add(message);
    io.emit('lobby:message', message);
    log.add('room', `${sender.nickname} posted an invite to ${room.roomId} in the world chat`);
    respond(ack, { ok: true });
  });

  listen(socket, 'queue:join', (payload) => {
    // Cannot sit in a room and a queue at once, or wait on a host meanwhile.
    withdrawRequest(socket.id);
    leaveCurrentRoom(socket);
    const pool = payload?.mode === 'ranked' ? 'ranked' : 'casual';
    queue.join(socket.id, identityOf(socket.id), pool);
    log.add('queue', `${nameOf(socket.id)} joined the ${pool} pool`);
    socket.emit('queue:status', queue.statusFor(socket.id));
  });

  listen(socket, 'queue:leave', () => {
    if (queue.leave(socket.id)) log.add('queue', `${nameOf(socket.id)} left the pool`);
    socket.emit('queue:status', null);
  });

  // Anyone with a name may report anyone else online. Who sent it and about
  // whom is filled in from the server's own records of both connections.
  listen(socket, 'player:report', (payload, ack) => {
    const reporter = partyOf(socket.id);
    if (!reporter) {
      respond(ack, { ok: false, error: 'Pick a name first.' });
      return;
    }
    const parsed = parseReport(payload);
    if (!parsed.ok) {
      respond(ack, { ok: false, error: parsed.error });
      return;
    }
    const target = partyOf(parsed.targetId);
    if (!target) {
      respond(ack, { ok: false, error: 'That player is no longer online.' });
      return;
    }
    if (parsed.targetId === socket.id || (reporter.profileId !== null && reporter.profileId === target.profileId)) {
      respond(ack, { ok: false, error: 'You cannot report yourself.' });
      return;
    }

    const verdict = reportLimit.tryReport(
      reportKey(reporter, socket.id),
      reportKey(target, parsed.targetId),
      Date.now(),
    );
    if (!verdict.ok) {
      const minutes = Math.max(1, Math.ceil(verdict.waitMs / 60_000));
      respond(ack, {
        ok: false,
        error:
          verdict.why === 'same-target'
            ? `You already reported ${target.nickname} — the admins have it. You can report them again in ${minutes} min.`
            : `That is a lot of reports — try again in ${minutes} min.`,
      });
      return;
    }

    const report: PlayerReport = {
      id: randomUUID(),
      createdAt: Date.now(),
      reason: parsed.reason,
      details: parsed.details,
      roomId: registry.get(parsed.targetId)?.roomId ?? registry.get(socket.id)?.roomId ?? null,
      reporter,
      target: { ...target, clientId: parsed.targetId },
      status: 'open',
      handledAt: null,
    };
    reports.add(report);
    void saveReport(report);
    log.add('moderation', `${describeReport(report)}${report.details ? ` — "${report.details}"` : ''}`);
    adminConsole.reportsChanged();
    respond(ack, { ok: true });
  });

  // Review coach: is it on for this finished game, and how many of the
  // questions allowed per game this person has left. A game is named by id
  // only — its facts come from the server's own copy, never from the client.
  listen(socket, 'review:coach', async (payload, ack) => {
    const ref = reviewRefOf(payload);
    if (!ref) {
      respond(ack, { ok: false, available: false, error: 'Say which game to ask about.' });
      return;
    }
    if (!coachModel) {
      respond(ack, { ok: false, available: false, error: 'The coach is not available on this server.' });
      return;
    }
    if (coachLookupLimit.trySend(socket.id, Date.now()) > 0) {
      respond(ack, { ok: false, available: false, error: 'Too many games opened at once. Try again in a minute.' });
      return;
    }

    const game = await settleWithin(findGame(ref, replays, loadReplay, Date.now), REPLAY_LOOKUP_TIMEOUT_MS, null);
    if (!game) {
      respond(ack, { ok: false, available: false, error: 'That game is not available to ask about any more.' });
      return;
    }
    respond(ack, {
      ok: true,
      available: true,
      questionsLeft: coachBook.left(coachPerson(socket.id), game.key(), Date.now()),
    });
    // Start the analysis now, so the first question does not wait for it.
    void reviewForCoach(game.replay);
  });

  // One question to the coach. Cleaned and limited first, then answered from
  // the game's facts. Only an answer that passed the checks counts against the
  // ten a person gets per game: a busy coach, or an answer thrown out, is free.
  listen(socket, 'review:ask', async (payload, ack) => {
    const refuse = (error: string, questionsLeft?: number) =>
      respond(ack, { ok: false, error, ...(questionsLeft === undefined ? {} : { questionsLeft }) });

    const ref = reviewRefOf(payload);
    if (!ref) return refuse('Say which game to ask about.');
    const question = cleanQuestion(payload?.question);
    if (!question.ok) return refuse(question.error);
    if (!coachModel) return refuse('The coach is not available on this server.');

    const wait = coachLimit.trySend(socket.id, Date.now());
    if (wait > 0) return refuse(`One question at a time — try again in ${Math.ceil(wait / 1000)} s.`);

    const game = await settleWithin(findGame(ref, replays, loadReplay, Date.now), REPLAY_LOOKUP_TIMEOUT_MS, null);
    if (!game) return refuse('That game is not available to ask about any more.');

    const person = coachPerson(socket.id);
    // Holds a place in the allowance while the model works, so two questions
    // sent at once cannot both take the last one.
    if (!coachBook.begin(person, game.key(), Date.now())) {
      return refuse(`You have asked all ${COACH_QUESTIONS_PER_GAME} questions about this game.`, 0);
    }

    let outcome: CoachOutcome = { kind: 'busy' };
    try {
      const review = await reviewForCoach(game.replay);
      if (review) {
        outcome = await askCoach(
          coachModel,
          {
            game: { replay: game.replay, review },
            question: question.text,
            history: coachBook.history(person, game.key(), Date.now()),
          },
          coachReserve,
        );
      }
    } catch (error) {
      console.error('[coach] a question failed:', error);
    }
    const turn: CoachTurn | null =
      outcome.kind === 'answer' ? { question: question.text, answer: outcome.answer } : null;
    coachBook.finish(person, game.key(), Date.now(), turn);
    const questionsLeft = coachBook.left(person, game.key(), Date.now());
    log.add('match', `${nameOf(socket.id)} asked the coach about a game — ${outcome.kind}`);

    if (outcome.kind === 'busy') return refuse(COACH_BUSY_ERROR);
    respond(ack, {
      ok: true,
      // An answer the checks threw out is never shown: a friendly line instead, and the question stays unspent.
      answer: outcome.kind === 'answer' ? outcome.answer : COACH_FALLBACK_ANSWER,
      questionsLeft,
    });
  });

  listen(socket, 'game:start', () => {
    rooms.roomOf(socket.id)?.start(socket.id);
  });

  // Non-numbers become NaN, which the engine rejects as out of bounds.
  listen(socket, 'game:reveal', (payload) => {
    rooms.roomOf(socket.id)?.reveal(socket.id, Number(payload?.row), Number(payload?.col));
  });

  listen(socket, 'game:rematch', () => {
    rooms.roomOf(socket.id)?.voteRematch(socket.id);
  });

  socket.on(
    'disconnect',
    contain(
      (reason: string) => {
        log.add('connection', `disconnect ${socket.id} "${nameOf(socket.id)}" — ${reason}`);
        withdrawRequest(socket.id);
        queue.leave(socket.id);

        // A seated player gets a grace period to come back; anyone else (lobby,
        // spectators, no session id) leaves at once.
        const room = rooms.roomOf(socket.id);
        if (sessionId && room?.isSeated(socket.id)) holdSeat(sessionId, socket.id, room);
        else leaveCurrentRoom(socket);

        registry.remove(socket.id);
        identities.delete(socket.id);
        guestIds.delete(socket.id);
        chatLimit.forget(socket.id);
        coachLimit.forget(socket.id);
        coachLookupLimit.forget(socket.id);
        pushUpdates();
      },
      (error) => handlerFailed(socket.id, 'disconnect', error, []),
    ),
  );
}, (error) => console.error('[connection] could not set up a client:', error)));

// ── static client + health ──────────────────────────────────────────────────

// A per-address cap on the routes that do work per request: /health and the
// index.html fallback (a file read for every deep link). Generous, so only a
// flood ever meets it. The built assets are left out: a page load is a dozen
// of them, and through a tunnel every visitor arrives from the same local
// address, so counting them would let one busy minute starve everyone. Socket.IO
// is not affected: its requests are answered before they reach express.
//
// 'trust proxy' stays off on purpose (admin/access.ts refuses forwarded
// requests), so the address counted is the direct peer. Behind a proxy every
// visitor then shares the proxy's allowance; the forwarded-header checks are
// switched off because that is a choice here, not a misconfiguration.
const httpLimit = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many requests. Please wait a minute and try again.',
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

app.get('/health', httpLimit, (_req, res) => {
  res.json({
    ok: true,
    clients: registry.count,
    rooms: rooms.list().length,
    uptimeMs: Date.now() - SERVER_STARTED_AT,
  });
});

// In production the built client is served from the same origin as the socket,
// so there is one port to open on EC2 and no CORS to configure.
const clientDist = path.resolve(__dirname, '../../client/dist');
const indexFile = path.join(clientDist, 'index.html');
app.use(express.static(clientDist));

/**
 * The built index.html, read when first asked for and again only if the file
 * changed (a rebuild while the server runs), judged by a cheap stat. Null while
 * there is no build, so the next request tries again.
 */
let indexPage: { mtimeMs: number; size: number; html: string } | null = null;

async function builtIndexHtml(): Promise<string | null> {
  try {
    const info = await stat(indexFile);
    if (indexPage?.mtimeMs === info.mtimeMs && indexPage.size === info.size) return indexPage.html;
    const html = await readFile(indexFile, 'utf8');
    indexPage = { mtimeMs: info.mtimeMs, size: info.size, html };
    return html;
  } catch {
    return null;
  }
}

/** Profile cards: answers remembered for a minute, so a crawler cannot lean on Supabase. */
const previewProfiles = new ProfileLookup(profileForPreview);

// Every other path gets the app, so deep links work. A room's share link and a
// player's profile link get their own title and description first: that is
// what chat apps read to draw the link's card (see preview.ts). Anything that
// goes wrong building that card sends the page as built.
app.get('*', httpLimit, async (req, res) => {
  const html = await builtIndexHtml();
  if (html === null) {
    res.status(404).send('Client not built. Run `npm run build`, or use `npm run dev`.');
    return;
  }

  let page = html;
  try {
    const card = await previewFor(req.path, {
      room: (code) => rooms.get(code)?.summary(),
      profile: (name) => previewProfiles.get(name),
    });
    if (card) page = renderPreview(html, card, PUBLIC_URL);
  } catch (error) {
    console.error('[preview] could not build a link preview:', error);
  }

  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(page);
});

// ── last line of defence ────────────────────────────────────────────────────
// Every socket handler, timer and matchmaking tick already contains its own
// failures, so anything that reaches here is a bug. Logging it and carrying on
// keeps every other match alive — during a live demo that matters more than a
// clean restart. Under Docker the restart policy still covers a process that
// dies anyway.
process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaught exception — server kept running:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled promise rejection — server kept running:', reason);
});

// Failing to listen (say, the port is already in use) must stop the process,
// not leave it running with nothing served.
httpServer.on('error', (error) => {
  console.error(`[fatal] could not listen on ${HOST}:${PORT}:`, error.message);
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  console.log(`
  Find My Mines server listening on ${HOST}:${PORT}
  Game    →  http://${ADVERTISED_HOST}:${PORT}
  Console →  http://${ADVERTISED_HOST}:${PORT}/admin
  Accounts→  ${supabaseEnabled ? 'Supabase connected' : 'guest-only (no SUPABASE_URL / SERVICE_ROLE_KEY)'}
  AI      →  ${advisor ? `solver + Groq ${advisor.model}` : 'solver only (no GROQ_API_KEY)'}
  JEV     →  ${jevPicker ? `TypeSafe ${jevPicker.model}` : 'not configured'}
  Coach   →  ${coachAdvisor ? `Groq ${coachAdvisor.model} (own key)` : advisor ? `Groq ${advisor.model} (shares the AI key)` : 'off (no Groq key)'}
`);
  printConsole();
  void loadAndPruneReports();
});
