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
  type ServerToAdminEvents,
  type ServerToClientEvents,
} from '@fmm/shared';
import { ADVERTISED_HOST, CORS_ORIGIN, HOST, PORT } from './config.js';
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
    matchEnded: (state) => to().emit('match:ended', state),
    matchReset: (state) => to().emit('match:reset', state),
    stateSync: (state) => to().emit('state:sync', state),
    error: (playerId, code, message) => io.to(playerId).emit('error:msg', { code, message }),
    changed: () => pushUpdates(),
  };
});

// ── broadcasting ────────────────────────────────────────────────────────────

function adminState(): AdminState {
  return {
    clientCount: registry.count,
    clients: registry.list(),
    rooms: rooms.list(),
    serverStartedAt: SERVER_STARTED_AT,
  };
}

/** Refresh the landing-page game list and the server console together. */
function pushUpdates(): void {
  io.emit('lobby:rooms', { rooms: rooms.list(), clientCount: registry.count });
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
    '───────────────────────────────────────────────────────────',
  ];
  console.log(lines.join('\n'));
}

/** Moves a socket out of its current room, closing that room if it emptied. */
function leaveCurrentRoom(socket: { id: string; leave: (room: string) => void }): void {
  const { roomId, closed } = rooms.leave(socket.id);
  if (!roomId) return;

  socket.leave(roomId);
  registry.setRoom(socket.id, null);
  registry.setSeat(socket.id, 'spectator');

  if (closed) {
    io.to(roomId).emit('room:closed', { roomId, reason: 'Everyone left the room.' });
  }
}

// ── game namespace ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  const address = socket.handshake.address ?? 'unknown';
  registry.add(socket.id, address);
  pushUpdates();

  socket.emit('lobby:rooms', { rooms: rooms.list(), clientCount: registry.count });

  socket.on('player:join', ({ nickname }, ack) => {
    const clean = String(nickname ?? '').trim().slice(0, 20) || 'Player';
    registry.setNickname(socket.id, clean);

    const result: JoinResult = {
      ok: true,
      playerId: socket.id,
      // Spec: "a welcome message with their nickname will appear".
      welcome: `Welcome, ${clean}.`,
    };
    ack?.(result);
    pushUpdates();
  });

  socket.on('room:create', ({ name, config }, ack) => {
    const created = rooms.create(name, config);
    if (!created.ok || !created.roomId) {
      ack?.({ ok: false, errors: created.errors ?? ['Could not create the room.'] });
      return;
    }

    leaveCurrentRoom(socket);

    const room = rooms.get(created.roomId)!;
    const nickname = registry.get(socket.id)?.nickname ?? 'Player';
    const seat = room.addPlayer(socket.id, nickname);

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

    leaveCurrentRoom(socket);

    const nickname = registry.get(socket.id)?.nickname ?? 'Player';
    const seat = asSpectator
      ? room.addSpectator(socket.id, nickname)
      : room.addPlayer(socket.id, nickname);

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
    socket.emit('lobby:rooms', { rooms: rooms.list(), clientCount: registry.count });
    pushUpdates();
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

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    registry.remove(socket.id);
    pushUpdates();
  });
});

// ── admin namespace (the server console) ────────────────────────────────────

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
`);
  printConsole();
});
