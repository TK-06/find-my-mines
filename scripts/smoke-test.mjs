/**
 * End-to-end smoke test over real sockets.
 *
 * Connects clients to a RUNNING server and exercises the full flow: nickname,
 * lobby, room creation, host start, a complete match, rematch, leaving, host
 * succession, room cleanup, and the admin console.
 *
 * The unit tests cover the engine and room-config rules; this covers the wire
 * protocol and everything stateful the server does.
 *
 * Usage:
 *   npm run dev:server            # terminal 1
 *   node scripts/smoke-test.mjs   # terminal 2
 */
import { io } from 'socket.io-client';

const URL = process.env.FMM_URL ?? 'http://localhost:3000';
const ADMIN_NS = '/admin';
const passed = [];
const failed = [];

function check(name, ok, detail = '') {
  (ok ? passed : failed).push(detail ? `${name} — ${detail}` : name);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

function connect(namespace = '') {
  return new Promise((resolve, reject) => {
    const socket = io(URL + namespace, { transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

const setName = (socket, nickname) => emitAck(socket, 'player:join', { nickname });

function waitFor(socket, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tracks the latest room state a socket has been told about. */
function track(socket) {
  const view = { state: null, ended: null, closed: null };
  const set = (s) => {
    view.state = s;
  };
  socket.on('state:sync', set);
  socket.on('match:start', (s) => {
    view.ended = null;
    set(s);
  });
  socket.on('match:reset', set);
  socket.on('cell:revealed', ({ state }) => set(state));
  socket.on('match:ended', (s) => {
    view.ended = s;
    set(s);
  });
  socket.on('turn:changed', ({ currentPlayerId, secondsLeft }) => {
    if (view.state) view.state = { ...view.state, currentPlayerId, secondsLeft };
  });
  socket.on('room:closed', (p) => {
    view.closed = p;
  });
  return view;
}

const CLASSIC = { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2 };

console.log(`\nFind My Mines — smoke test against ${URL}`);

// ── admin console ───────────────────────────────────────────────────────────
section('admin console');

// The server emits admin:state the instant the socket connects, so the listener
// must be attached before the connection completes.
const admin = io(URL + ADMIN_NS, {
  transports: ['websocket'],
  forceNew: true,
  auth: { token: process.env.ADMIN_TOKEN ?? '' },
});
const firstAdminState = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout waiting for admin:state')), 6000);
  admin.once('admin:state', (state) => {
    clearTimeout(timer);
    resolve(state);
  });
  admin.once('connect_error', (err) => {
    clearTimeout(timer);
    reject(err);
  });
});
check('admin console receives state on connect', Boolean(firstAdminState));
check('admin state exposes a room list', Array.isArray(firstAdminState.rooms));

// Keep the newest snapshot around. Waiting for a *fresh* push is unreliable at
// the end of the run, when nothing is changing any more.
let latestAdmin = firstAdminState;
admin.on('admin:state', (state) => {
  latestAdmin = state;
});

// ── nickname + lobby ────────────────────────────────────────────────────────
section('nickname and lobby');

const alice = await connect();
const aliceView = track(alice);
const aliceLobby = waitFor(alice, 'lobby:rooms');
const aliceJoin = await setName(alice, 'Alice');

check('welcome message uses the nickname', aliceJoin.welcome === 'Welcome, Alice.', aliceJoin.welcome);
check('naming yields a player id', Boolean(aliceJoin.playerId));
check('landing page receives the game list', Array.isArray((await aliceLobby).rooms));

// ── create a Classic room ───────────────────────────────────────────────────
section('room creation');

const badRoom = await emitAck(alice, 'room:create', {
  name: 'Impossible',
  config: { rows: 4, cols: 4, mineCount: 16, maxPlayers: 2 },
});
check('server rejects an invalid config', badRoom.ok === false, badRoom.errors?.[0] ?? '');

const created = await emitAck(alice, 'room:create', { name: 'Classic Room', config: CLASSIC });
check('host can create a room', created.ok === true);
check('creator is seated as a player', created.seat === 'player');
const roomId = created.roomId;
check('room gets a short code', Boolean(roomId) && roomId.length === 4, roomId);

await sleep(150);
check('room appears in the lobby list', aliceView.state?.roomId === roomId);
check('creator is the host', aliceView.state?.hostId === aliceJoin.playerId);
check('board is 6x6', aliceView.state?.rows === 6 && aliceView.state?.cols === 6);
check('board declares 11 mines', aliceView.state?.bombCount === 11);
check('all slots start covered', aliceView.state?.revealed.length === 0);

// ── second player joins, host starts ────────────────────────────────────────
section('joining and starting');

const bob = await connect();
const bobView = track(bob);
const bobJoin = await setName(bob, 'Bob');
const bobEnter = await emitAck(bob, 'room:join', { roomId });
check('second client is seated as a player', bobEnter.seat === 'player');

const tooEarly = await emitAck(bob, 'room:join', { roomId: 'ZZZZ' });
check('joining a missing room fails cleanly', tooEarly.ok === false);

const notHost = waitFor(bob, 'error:msg', 2500).catch(() => null);
bob.emit('game:start');
check('non-host cannot start the match', (await notHost)?.code === 'NOT_HOST');

const started = waitFor(alice, 'match:start');
alice.emit('game:start');
const start = await started;

check('host can start the match', start.status === 'playing');
check('a first player was selected', Boolean(start.currentPlayerId));
check('mine positions never reach the client', !JSON.stringify(start).includes('bombs"'));

// ── full room becomes spectator ─────────────────────────────────────────────
section('spectators');

const carol = await connect();
const carolView = track(carol);
const carolJoin = await setName(carol, 'Carol');
const carolEnter = await emitAck(carol, 'room:join', { roomId });
check('joining a full room seats you as a spectator', carolEnter.seat === 'spectator');

const dave = await connect();
const daveJoin = await setName(dave, 'Dave');
const daveEnter = await emitAck(dave, 'room:spectate', { roomId });
check('explicit spectate works', daveEnter.seat === 'spectator');
await sleep(150);
check('spectator count is reported', aliceView.state?.spectatorCount === 2, String(aliceView.state?.spectatorCount));

// ── turn enforcement ────────────────────────────────────────────────────────
section('turn enforcement');

const byId = { [aliceJoin.playerId]: alice, [bobJoin.playerId]: bob };
const offTurn = start.currentPlayerId === aliceJoin.playerId ? bob : alice;
const rejection = waitFor(offTurn, 'error:msg', 3000).catch(() => null);
offTurn.emit('game:reveal', { row: 0, col: 0 });
check('a move out of turn is rejected', (await rejection)?.code === 'NOT_YOUR_TURN');

const specReject = waitFor(carol, 'error:msg', 3000).catch(() => null);
carol.emit('game:reveal', { row: 1, col: 1 });
check('a spectator cannot reveal', Boolean(await specReject));

// ── play the match to completion ────────────────────────────────────────────
section('full match');

async function playOut(view, sockets, budgetMs = 45000) {
  const attempted = new Set();
  const deadline = Date.now() + budgetMs;
  while (!view.ended && Date.now() < deadline) {
    const state = view.state;
    const active = state && sockets[state.currentPlayerId];
    if (!active) {
      await sleep(50);
      continue;
    }
    const done = new Set(state.revealed.map((c) => `${c.row}:${c.col}`));
    let target = null;
    for (let row = 0; row < state.rows && !target; row++) {
      for (let col = 0; col < state.cols && !target; col++) {
        const key = `${row}:${col}`;
        if (!done.has(key) && !attempted.has(`${state.currentPlayerId}|${key}`)) {
          target = { row, col, key };
        }
      }
    }
    if (!target) {
      await sleep(80);
      continue;
    }
    attempted.add(`${state.currentPlayerId}|${target.key}`);
    active.emit('game:reveal', { row: target.row, col: target.col });
    await sleep(70);
  }
  return view.ended;
}

const ended = await playOut(aliceView, byId);
check('match ended within the time budget', Boolean(ended), ended ? '' : 'timed out');

if (ended) {
  const minesRevealed = ended.revealed.filter((c) => c.kind === 'bomb').length;
  const totalScore = ended.players.reduce((sum, p) => sum + p.score, 0);

  check('all 11 mines were found', minesRevealed === 11, String(minesRevealed));
  check('scores sum to the mine count', totalScore === 11, String(totalScore));
  check('a winner was declared', Boolean(ended.winnerId));
  check(
    'every empty slot carries an adjacent-mine count',
    ended.revealed.filter((c) => c.kind === 'empty').every((c) => typeof c.adjacent === 'number'),
  );
  check('cumulative totals were banked', ended.players.every((p) => p.totalScore === p.score));
  check('spectators saw the finished match', carolView.ended?.winnerId === ended.winnerId);

  // ── rematch ───────────────────────────────────────────────────────────────
  section('rematch');

  const previousWinner = ended.winnerId;
  const restarted = waitFor(alice, 'match:start', 6000).catch(() => null);
  alice.emit('game:rematch');
  await sleep(200);
  check('one vote is not enough to restart', aliceView.state?.status === 'ended');
  bob.emit('game:rematch');
  const next = await restarted;

  check('both votes trigger a rematch', Boolean(next));
  check(
    'the previous winner starts the rematch',
    next?.currentPlayerId === previousWinner,
    `expected ${previousWinner}, got ${next?.currentPlayerId}`,
  );
  check('the rematch board is freshly covered', next?.revealed.length === 0);
  check(
    'match scores reset while totals persist',
    Boolean(next?.players.every((p) => p.score === 0 && p.totalScore > 0)),
  );
}

// ── admin: clients, rooms, reset ────────────────────────────────────────────
section('admin console state');

// Use the tracked snapshot rather than waiting for a fresh push: by this point
// the state may already be settled, and no new push would arrive.
await sleep(400);
const adminSnapshot = latestAdmin;

if (adminSnapshot) {
  // An absolute count is fragile — any stray browser tab left open connects a
  // socket too. Assert the count covers our four and matches the listed clients.
  check(
    'admin reports the connected client count',
    adminSnapshot.clientCount >= 4 && adminSnapshot.clientCount === adminSnapshot.clients.length,
    String(adminSnapshot.clientCount),
  );
  check(
    'admin lists every connected client',
    ['Alice', 'Bob', 'Carol', 'Dave'].every((n) =>
      adminSnapshot.clients.some((c) => c.nickname === n),
    ),
    adminSnapshot.clients.map((c) => c.nickname).join(', '),
  );
  check('admin lists the room', adminSnapshot.rooms.some((r) => r.id === roomId));
  check(
    'admin shows which room each client is in',
    adminSnapshot.clients.filter((c) => c.roomId === roomId).length === 4,
    `${adminSnapshot.clients.filter((c) => c.roomId === roomId).length} in ${roomId}`,
  );
} else {
  check('admin snapshot', false, 'no admin:state received');
}

const afterReset = new Promise((resolve) => {
  const seen = [];
  const handler = (state) => {
    seen.push(state);
    if (seen.length >= 2) {
      admin.off('admin:state', handler);
      resolve(seen.at(-1));
    }
  };
  admin.on('admin:state', handler);
  setTimeout(() => {
    admin.off('admin:state', handler);
    resolve(seen.at(-1) ?? null);
  }, 2500);
});
admin.emit('admin:reset', { roomId });
const resetState = await afterReset;

if (resetState) {
  const room = resetState.rooms.find((r) => r.id === roomId);
  check('per-room reset returns the room to waiting', room?.status === 'waiting', room?.status);
  await sleep(150);
  check(
    'reset zeroes both match and cumulative scores',
    Boolean(aliceView.state?.players.every((p) => p.score === 0 && p.totalScore === 0)),
  );
}


// ── matchmaking ─────────────────────────────────────────────────────────────
section('matchmaking');

for (const socket of [alice, bob, carol, dave]) socket.emit('room:leave');
await sleep(300);

const aliceQueued = waitFor(alice, 'queue:status', 4000).catch(() => null);
alice.emit('queue:join', { mode: 'casual' });
const queueStatus = await aliceQueued;
check('joining the pool reports a status', Boolean(queueStatus), queueStatus?.mode ?? 'none');
check('the pool reports the waiting mode', queueStatus?.mode === 'casual');

// One player alone must never be paired with themselves. Assert against the
// server's own pool, not the client's stale room state.
await sleep(1500);
check('a lone player stays queued and is not self-matched',
  latestAdmin?.queue?.length === 1 && latestAdmin.queue[0].nickname === 'Alice',
  `${latestAdmin?.queue?.length ?? 0} queued`);

const aliceMatched = waitFor(alice, 'queue:matched', 8000).catch(() => null);
const bobMatched = waitFor(bob, 'queue:matched', 8000).catch(() => null);
bob.emit('queue:join', { mode: 'casual' });

const [aMatch, bMatch] = await Promise.all([aliceMatched, bobMatched]);
check('both players were matched', Boolean(aMatch) && Boolean(bMatch));
check('both landed in the same room', aMatch?.roomId === bMatch?.roomId, aMatch?.roomId ?? '');

await sleep(500);
check('the matched room auto-started', aliceView.state?.status === 'playing', aliceView.state?.status ?? 'none');
check('the matched room seats exactly two', aliceView.state?.players.length === 2);
check('the matched room uses the queued mode', aliceView.state?.config.mode === 'casual');

// Cancelling must clear the status and empty the pool.
for (const socket of [alice, bob]) socket.emit('room:leave');
await sleep(300);

// The queue ticks every second, so a single once() can catch a periodic update
// instead of the cancellation. Track the latest value and assert on that.
let carolStatus = 'unset';
carol.on('queue:status', (payload) => { carolStatus = payload; });

carol.emit('queue:join', { mode: 'ranked' });
await sleep(600);
check('the queued player has a live status', carolStatus !== null && carolStatus !== 'unset',
  JSON.stringify(carolStatus));
check('the admin pool shows the queued player', latestAdmin?.queue?.length === 1);

carol.emit('queue:leave');
await sleep(800);
check('cancelling clears the queue status', carolStatus === null, JSON.stringify(carolStatus));
check('the admin console reports an empty pool', (latestAdmin?.queue?.length ?? -1) === 0,
  String(latestAdmin?.queue?.length ?? 'missing'));
carol.off('queue:status');

// ── unlimited room with 4 players ───────────────────────────────────────────
section('free-for-all room');

for (const socket of [alice, bob, carol, dave]) socket.emit('room:leave');
await sleep(300);

const ffa = await emitAck(alice, 'room:create', {
  name: 'Everyone',
  config: { rows: 6, cols: 6, mineCount: 11, maxPlayers: null },
});
check('unlimited room can be created', ffa.ok === true);

const seats = [];
for (const socket of [bob, carol, dave]) {
  const res = await emitAck(socket, 'room:join', { roomId: ffa.roomId });
  seats.push(res.seat);
}
check('unlimited room seats everyone', seats.every((s) => s === 'player'), seats.join(','));

const ffaStarted = waitFor(alice, 'match:start', 6000).catch(() => null);
alice.emit('game:start');
const ffaStart = await ffaStarted;
check('free-for-all match starts with 4 players', ffaStart?.players.length === 4);

// Turn rotation must actually visit players beyond the first, and the
// leaderboard must stay sorted as scores diverge.
const seenTurns = new Set([ffaStart?.currentPlayerId].filter(Boolean));
alice.on('turn:changed', ({ currentPlayerId }) => seenTurns.add(currentPlayerId));

const ffaById = {
  [aliceJoin.playerId]: alice,
  [bobJoin.playerId]: bob,
  [carolJoin.playerId]: carol,
  [daveJoin.playerId]: dave,
};

// Drive real moves so the turn genuinely rotates rather than just timing out.
const ffaAttempted = new Set();
for (let move = 0; move < 12; move++) {
  const state = aliceView.state;
  const active = state && ffaById[state.currentPlayerId];
  if (!active || state.status !== 'playing') break;

  const done = new Set(state.revealed.map((c) => `${c.row}:${c.col}`));
  let target = null;
  for (let row = 0; row < state.rows && !target; row++) {
    for (let col = 0; col < state.cols && !target; col++) {
      const key = `${row}:${col}`;
      if (!done.has(key) && !ffaAttempted.has(`${state.currentPlayerId}|${key}`)) {
        target = { row, col, key };
      }
    }
  }
  if (!target) break;
  ffaAttempted.add(`${state.currentPlayerId}|${target.key}`);
  active.emit('game:reveal', { row: target.row, col: target.col });
  await sleep(120);
}

check(
  'turn rotation reaches at least three of the four players',
  seenTurns.size >= 3,
  `${seenTurns.size} distinct players took a turn`,
);

const ranked = [...(aliceView.state?.players ?? [])].sort((a, b) => b.score - a.score);
check(
  'leaderboard ordering matches score ordering',
  ranked.every((p, i) => i === 0 || ranked[i - 1].score >= p.score),
  ranked.map((p) => `${p.nickname}:${p.score}`).join(' '),
);

// ── leaving, host succession, room cleanup ──────────────────────────────────
section('leaving and host succession');

const hostBefore = ffaStart?.hostId;
check('creator hosts the free-for-all room', hostBefore === aliceJoin.playerId);

alice.emit('room:leave');
await sleep(400);
check(
  'host leaving promotes the earliest-joined player',
  bobView.state?.hostId === bobJoin.playerId,
  `host is now ${bobView.state?.hostId}`,
);

for (const socket of [bob, carol, dave]) {
  socket.emit('room:leave');
  await sleep(150);
}
await sleep(300);

await sleep(500);
const finalAdmin = latestAdmin;
check(
  'a room with no members is destroyed',
  Boolean(finalAdmin) && !finalAdmin.rooms.some((r) => r.id === ffa.roomId),
  finalAdmin ? `${finalAdmin.rooms.length} room(s) left` : 'no admin:state received',
);

// ── forfeit and leaving after a match ──────────────────────────────────────
section('forfeit and leaving');

{
  const p1 = await connect();
  const p2 = await connect();
  await setName(p1, 'Fern');
  await setName(p2, 'Gus');
  const p1View = track(p1);
  const p2View = track(p2);
  const forfeits = [];
  const notices = [];
  p1.on('match:forfeit', (n) => forfeits.push(n));
  p1.on('room:notice', (n) => notices.push(n.message));

  const room = await emitAck(p1, 'room:create', { name: 'Forfeit', config: CLASSIC });
  await emitAck(p2, 'room:join', { roomId: room.roomId });
  p1.emit('game:start');
  await sleep(400);

  let lateToLeaver = 0;
  p2.on('state:sync', () => lateToLeaver++);
  p2.emit('room:leave');
  await sleep(500);

  const forfeit = forfeits[0];
  check('leaving mid-match hands the other player a forfeit win',
    forfeit?.winnerId === p1.id && forfeit?.leaverNickname === 'Gus',
    forfeit ? `winner ${forfeit.winnerNickname}` : 'no match:forfeit');
  check('the room goes back to waiting after a forfeit', p1View.state?.status === 'waiting',
    p1View.state?.status);
  check('the leaver gets no room updates after leaving', lateToLeaver === 0, `${lateToLeaver} late`);

  // Finish a real match, have one side vote rematch, then the other leaves.
  await emitAck(p2, 'room:join', { roomId: room.roomId });
  await sleep(200);
  p1.emit('game:start');
  await sleep(300);
  const done = await playOut(p1View, { [p1.id]: p1, [p2.id]: p2 });
  check('second match ended', Boolean(done));

  p1.emit('game:rematch');
  await sleep(200);
  lateToLeaver = 0;
  p2.emit('room:leave');
  await sleep(500);

  check('leaving after a rematch vote sends the leaver nothing further', lateToLeaver === 0,
    `${lateToLeaver} late`);
  check('the remaining player is told the other left', notices.some((m) => m.includes('Gus left')),
    notices.join(' | ') || 'no room:notice');
  check('the remaining player is back to waiting, not stuck on the result',
    p1View.state?.status === 'waiting', p1View.state?.status);

  p1.close();
  p2.close();
}

for (const socket of [alice, bob, carol, dave, admin]) socket.close();

console.log(`\n${passed.length} passed, ${failed.length} failed\n`);
if (failed.length > 0) {
  failed.forEach((name) => console.log(`  x ${name}`));
  process.exit(1);
}
process.exit(0);
