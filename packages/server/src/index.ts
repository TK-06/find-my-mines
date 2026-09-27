import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Namespace, type Socket } from 'socket.io';
import {
  ADMIN_NAMESPACE,
  CLASSIC_PRESET,
  RECONNECT_GRACE_SECONDS,
  describeReasons,
  parseRemovalNote,
  presenceOf,
  type AdminState,
  type AdminToServerEvents,
  type ClientToServerEvents,
  type Identity,
  type JoinResult,
  type OnlinePlayer,
  type QueueEntry,
  type RemovalNote,
  type RemovalNotice,
  type RevealedCell,
  type RoomConfig,
  type RoomMode,
  type Seat,
  type ServerToAdminEvents,
  type ServerToClientEvents,
} from '@fmm/shared';
import { attachAdminNamespace } from './admin/adminNamespace.js';
import { ActivityLog } from './admin/activityLog.js';
import { contain, respond, settleWithin } from './safety.js';
import { ADVERTISED_HOST, CORS_ORIGIN, HOST, PORT } from './config.js';
import { MatchmakingQueue } from './matchmaking/queue.js';
import { recordMatch } from './persistence/matchRecorder.js';
import { guestIdentity, identityFromToken, supabaseEnabled } from './supabase.js';
import type { FinishedMatch, MatchBroadcaster, MatchManager } from './match/matchManager.js';
import { RoomManager } from './rooms/roomManager.js';
import { ClientRegistry } from './state/registry.js';
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
    },
    cellRevealed: (cell: RevealedCell, state) => {
      to().emit('cell:revealed', { cell, state });
      watched();
    },
    turnChanged: (currentPlayerId, secondsLeft) => {
      to().emit('turn:changed', { currentPlayerId, secondsLeft });
      watched();
    },
    turnTick: (secondsLeft) => {
      to().emit('turn:tick', { secondsLeft });
      watched();
    },
    matchEnded: (state) => {
      to().emit('match:ended', state);
      const winner = state.players.find((p) => p.id === state.winnerId);
      const scores = state.players.map((p) => `${p.nickname} ${p.score}`).join(', ');
      log.add('match', `${roomId} ended — ${winner ? `${winner.nickname} won` : 'a draw'} (${scores})`);
      const result = rooms.get(roomId)?.takeResult();
      if (result) {
        carryRatings(result);
        persistResult(result);
      }
      watched();
    },
    matchReset: (state) => {
      to().emit('match:reset', state);
      watched();
    },
    stateSync: (state) => {
      to().emit('state:sync', state);
      watched();
    },
    matchForfeited: (notice, result) => {
      to().emit('match:forfeit', notice);
      log.add(
        'match',
        `${roomId} forfeited — ${notice.winnerNickname} won, ${notice.leaverNickname} left mid-match`,
      );
      if (result) {
        carryRatings(result);
        persistResult(result);
      }
      watched();
    },
    notice: (message) => to().emit('room:notice', { message }),
    error: (playerId, code, message) => io.to(playerId).emit('error:msg', { code, message }),
    changed: () => pushUpdates(),
  };
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
function persistResult(result: FinishedMatch): void {
  void recordMatch(result)
    .then((matchId) => {
      if (!matchId) return;
      for (const player of result.players) {
        io.to(player.clientId).emit('match:recorded', { matchId });
      }
    })
    .catch((error: unknown) => console.error('[persist] could not report the saved match:', error));
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

function identityOf(socketId: string): Identity {
  return identities.get(socketId) ?? guestIdentity('Player');
}

/** A readable name for logs: the nickname once known, else the socket id. */
function nameOf(socketId: string): string {
  return identities.get(socketId)?.nickname ?? socketId;
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
        roomId: client.roomId,
      },
    ];
  });
}

function lobbyPayload() {
  return { rooms: rooms.list(), clientCount: registry.count, online: onlinePlayers() };
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
    adminConsole.roomChanged(roomId);
    pushUpdates();
    return true;
  },

  reset: (roomId?: string) => {
    rooms.reset(roomId);
    pushUpdates();
  },
});

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
  const address = socket.handshake.address ?? 'unknown';
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
        pushUpdates();
      },
      (error) => handlerFailed(socket.id, 'disconnect', error, []),
    ),
  );
}, (error) => console.error('[connection] could not set up a client:', error)));

// ── static client + health ──────────────────────────────────────────────────

app.get('/health', (_req, res) => {
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
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run `npm run build`, or use `npm run dev`.');
  });
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
`);
  printConsole();
});
