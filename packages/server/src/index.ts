import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Namespace } from 'socket.io';
import {
  ADMIN_NAMESPACE,
  type AdminState,
  type AdminToServerEvents,
  type ClientToServerEvents,
  type JoinResult,
  type RevealedCell,
  type RoomActionResult,
  type Identity,
  type ServerToAdminEvents,
  type ServerToClientEvents,
} from '@fmm/shared';
import {
  CLASSIC_PRESET,
  RECONNECT_GRACE_SECONDS,
  type QueueEntry,
  type RoomMode,
} from '@fmm/shared';
import { ADMIN_TOKEN, ADVERTISED_HOST, CORS_ORIGIN, HOST, PORT } from './config.js';
import { MatchmakingQueue } from './matchmaking/queue.js';
import { recordMatch } from './persistence/matchRecorder.js';
import { guestIdentity, identityFromToken, supabaseEnabled } from './supabase.js';
import type { MatchBroadcaster } from './match/matchManager.js';
import { RoomManager } from './rooms/roomManager.js';
import { ClientRegistry } from './state/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_STARTED_AT = Date.now();

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

const registry = new ClientRegistry();

/**
 * Every match event is scoped to its own socket.io room, so a reveal in one
 * game is invisible to every other game on the server.
 */
const rooms = new RoomManager((roomId): MatchBroadcaster => {
  const to = () => io.to(roomId);
  return {
    matchStart: (state) => to().emit('match:start', state),
    cellRevealed: (cell: RevealedCell, state) => to().emit('cell:revealed', { cell, state }),
    turnChanged: (currentPlayerId, secondsLeft) =>
      to().emit('turn:changed', { currentPlayerId, secondsLeft }),
    turnTick: (secondsLeft) => to().emit('turn:tick', { secondsLeft }),
    matchEnded: (state) => {
      to().emit('match:ended', state);
      // Ratings are already applied in memory; persisting is best-effort and
      // must never block or break the match that just finished.
      const result = rooms.get(roomId)?.takeResult();
      if (result) void recordMatch(result);
    },
    matchReset: (state) => to().emit('match:reset', state),
    stateSync: (state) => to().emit('state:sync', state),
    matchForfeited: (notice, result) => {
      to().emit('match:forfeit', notice);
      if (result) void recordMatch(result);
    },
    notice: (message) => to().emit('room:notice', { message }),
    error: (playerId, code, message) => io.to(playerId).emit('error:msg', { code, message }),
    changed: () => pushUpdates(),
  };
});

/**
 * Matchmaking pool.
 *
 * A paired match is auto-started: neither player chose the room, so there is no
 * meaningful host to wait on. The earliest-seated player still holds the host
 * role for anything that happens afterwards, like a rematch.
 */
const queue = new MatchmakingQueue({
  onPair: (a: QueueEntry, b: QueueEntry, mode: RoomMode) => {
    const created = rooms.create(`${a.nickname} vs ${b.nickname}`, {
      ...CLASSIC_PRESET,
      maxPlayers: 2,
      mode,
    });
    if (!created.ok || !created.roomId) return null;

    const room = rooms.get(created.roomId)!;

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

function lobbyPayload() {
  return { rooms: rooms.list(), clientCount: registry.count, online: registry.roster() };
}

/** Refresh the landing-page game list and the server console together. */
function pushUpdates(): void {
  io.emit('lobby:rooms', lobbyPayload());
  adminIo.emit('admin:state', adminState());
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
  const current = rooms.roomIdOf(socket.id);
  if (!current) return;

  // Leave the socket.io room BEFORE the match reacts to the departure. The
  // room's final state:sync would otherwise still reach the leaver and pull
  // their client back onto a room they already left.
  socket.leave(current);
  const { roomId, closed } = rooms.leave(socket.id);
  if (!roomId) return;

  registry.setRoom(socket.id, null);
  registry.setSeat(socket.id, 'spectator');

  if (closed) {
    io.to(roomId).emit('room:closed', { roomId, reason: 'Everyone left the room.' });
  }
}

/** Verified identity per socket. Populated on player:join, cleared on disconnect. */
const identities = new Map<string, Identity>();

function identityOf(socketId: string): Identity {
  return identities.get(socketId) ?? guestIdentity('Player');
}

/**
 * Seats held for players whose connection dropped, keyed by the per-tab
 * session id the client sends in its handshake. A reconnect with the same id
 * inside the grace window takes the seat back; otherwise the timer runs the
 * normal leave (a forfeit, mid-match).
 */
const heldSeats = new Map<
  string,
  { socketId: string; roomId: string; timer: ReturnType<typeof setTimeout> }
>();

function sessionIdOf(socket: { handshake: { auth?: Record<string, unknown> } }): string | null {
  const id = socket.handshake.auth?.sessionId;
  return typeof id === 'string' && id.length >= 16 && id.length <= 64 ? id : null;
}

// ── game namespace ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  const address = socket.handshake.address ?? 'unknown';
  registry.add(socket.id, address);
  pushUpdates();

  socket.emit('lobby:rooms', lobbyPayload());

  const sessionId = sessionIdOf(socket);

  socket.on('player:join', async ({ nickname }, ack) => {
    const clean = String(nickname ?? '').trim().slice(0, 20) || 'Player';

    // The access token comes from the handshake, and the server verifies it
    // against Supabase. Nothing the client says about its own identity is
    // trusted — no token simply means guest.
    const token = socket.handshake.auth?.accessToken as string | undefined;
    const identity = await identityFromToken(token, clean);
    identities.set(socket.id, identity);

    registry.setNickname(socket.id, identity.nickname);

    const resumed = resumeHeldSeat(socket);

    const result: JoinResult = {
      ok: true,
      playerId: socket.id,
      // Spec: "a welcome message with their nickname will appear".
      welcome: `Welcome, ${identity.nickname}.`,
      isGuest: identity.isGuest,
      elo: identity.elo,
      roomId: resumed?.roomId,
    };
    ack?.(result);
    // After the ack, so the client already knows which room this is for.
    if (resumed) socket.emit('state:sync', resumed.publicState());
    pushUpdates();
  });

  socket.on('room:create', ({ name, config }, ack) => {
    const created = rooms.create(name, config);
    if (!created.ok || !created.roomId) {
      ack?.({ ok: false, errors: created.errors ?? ['Could not create the room.'] });
      return;
    }

    queue.leave(socket.id);
    leaveCurrentRoom(socket);

    const room = rooms.get(created.roomId)!;
    const seat = room.addPlayer(socket.id, identityOf(socket.id));

    rooms.track(socket.id, created.roomId);
    socket.join(created.roomId);
    registry.setRoom(socket.id, created.roomId);
    registry.setSeat(socket.id, seat);

    ack?.({ ok: true, roomId: created.roomId, seat });
    io.to(created.roomId).emit('state:sync', room.publicState());
    pushUpdates();
  });

  const enterRoom = (
    roomId: string,
    asSpectator: boolean,
    ack?: (result: RoomActionResult) => void,
  ) => {
    const room = rooms.get(String(roomId ?? '').toUpperCase());
    if (!room) {
      ack?.({ ok: false, errors: ['That room no longer exists.'] });
      return;
    }

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

    ack?.({ ok: true, roomId: room.roomId, seat });
    // Everyone already in the room needs the new roster too, not just the
    // arriving client — otherwise player and spectator counts go stale.
    io.to(room.roomId).emit('state:sync', room.publicState());
    pushUpdates();
  };

  socket.on('room:join', ({ roomId }, ack) => enterRoom(roomId, false, ack));
  socket.on('room:spectate', ({ roomId }, ack) => enterRoom(roomId, true, ack));

  socket.on('room:leave', () => {
    leaveCurrentRoom(socket);
    socket.emit('lobby:rooms', lobbyPayload());
    pushUpdates();
  });

  socket.on('queue:join', ({ mode }) => {
    // Cannot sit in a room and a queue at once.
    leaveCurrentRoom(socket);
    queue.join(socket.id, identityOf(socket.id), mode === 'ranked' ? 'ranked' : 'casual');
    socket.emit('queue:status', queue.statusFor(socket.id));
  });

  socket.on('queue:leave', () => {
    queue.leave(socket.id);
    socket.emit('queue:status', null);
  });

  socket.on('game:start', () => {
    rooms.roomOf(socket.id)?.start(socket.id);
  });

  socket.on('game:reveal', ({ row, col }) => {
    rooms.roomOf(socket.id)?.reveal(socket.id, Number(row), Number(col));
  });

  socket.on('game:rematch', () => {
    rooms.roomOf(socket.id)?.voteRematch(socket.id);
  });

  /** Takes back a seat held for this tab, if there is one. */
  function resumeHeldSeat(target: typeof socket) {
    const held = sessionId ? heldSeats.get(sessionId) : undefined;
    if (!held || !sessionId) return null;

    clearTimeout(held.timer);
    heldSeats.delete(sessionId);

    const room = rooms.get(held.roomId);
    if (!room || !room.rebind(held.socketId, target.id)) return null;

    rooms.retrack(held.socketId, target.id);
    target.join(room.roomId);
    registry.setRoom(target.id, room.roomId);
    registry.setSeat(target.id, 'player');
    return room;
  }

  socket.on('disconnect', () => {
    queue.leave(socket.id);

    // A seated player gets a grace period to come back; anyone else (lobby,
    // spectators, no session id) leaves at once, as before.
    const room = rooms.roomOf(socket.id);
    if (sessionId && room?.isSeated(socket.id)) {
      room.markDisconnected(socket.id);
      const previous = heldSeats.get(sessionId);
      if (previous) clearTimeout(previous.timer);
      heldSeats.set(sessionId, {
        socketId: socket.id,
        roomId: room.roomId,
        timer: setTimeout(() => {
          heldSeats.delete(sessionId);
          leaveCurrentRoom(socket);
          pushUpdates();
        }, RECONNECT_GRACE_SECONDS * 1000),
      });
    } else {
      leaveCurrentRoom(socket);
    }

    registry.remove(socket.id);
    identities.delete(socket.id);
    pushUpdates();
  });
});

// ── admin namespace (the server console) ────────────────────────────────────

adminIo.use((socket, next) => {
  if (!ADMIN_TOKEN || socket.handshake.auth?.token === ADMIN_TOKEN) return next();
  next(new Error('Admin token required: open /admin?token=<ADMIN_TOKEN>.'));
});

adminIo.on('connection', (socket) => {
  socket.emit('admin:state', adminState());

  socket.on('admin:reset', (payload) => {
    const roomId = payload?.roomId;
    console.log(`[admin] Reset requested for ${roomId ?? 'ALL rooms'}.`);
    rooms.reset(roomId);
    pushUpdates();
  });
});

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

httpServer.listen(PORT, HOST, () => {
  console.log(`
  Find My Mines server listening on ${HOST}:${PORT}
  Game    →  http://${ADVERTISED_HOST}:${PORT}
  Console →  http://${ADVERTISED_HOST}:${PORT}/admin
  Accounts→  ${supabaseEnabled ? 'Supabase connected' : 'guest-only (no SUPABASE_URL / SERVICE_ROLE_KEY)'}
`);
  printConsole();
});
