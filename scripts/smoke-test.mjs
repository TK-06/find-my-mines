/**
 * End-to-end smoke test over real sockets.
 *
 * Connects clients to a RUNNING server and exercises the full flow: nickname,
 * lobby, the online list, room creation, host start, a complete match,
 * rematch, leaving, forfeits, the reconnect grace period, host succession,
 * room cleanup, host and admin moderation, and the admin console (viewer,
 * mine toggle, terminal log, access check).
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

// A missing server handler never acks; time out so it fails the check instead
// of hanging the whole run.
const emitAck = (socket, event, payload) =>
  new Promise((resolve) =>
    socket.timeout(5000).emit(event, payload, (err, result) =>
      resolve(err ? { ok: false, error: `no ack for ${event}` } : result),
    ),
  );

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

/** The newest lobby broadcast a socket has seen, including the online list. */
function trackLobby(socket) {
  const view = { latest: null };
  socket.on('lobby:rooms', (payload) => {
    view.latest = payload;
  });
  return view;
}

const CLASSIC = { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2 };
const REASON = { reasons: ['afk'], remark: 'smoke test' };

console.log(`\nFind My Mines — smoke test against ${URL}`);

// ── admin console ───────────────────────────────────────────────────────────
section('admin console');

// The server emits admin:state the instant the socket connects, so the listener
// must be attached before the connection completes.
// From the server machine no token is needed; against a hosted server that
// sets ADMIN_TOKEN, pass it in the environment.
const admin = io(URL + ADMIN_NS, {
  transports: ['websocket'],
  forceNew: true,
  auth: { token: process.env.ADMIN_TOKEN ?? '' },
});
// The terminal backfill also arrives on connect, so collect it from the start.
const adminLog = [];
admin.on('admin:log', (lines) => adminLog.push(...lines));
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
const aliceLobbyView = trackLobby(alice);
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
check(
  'spectators are listed by name',
  ['Carol', 'Dave'].every((n) => aliceView.state?.spectators?.some((s) => s.nickname === n)),
  JSON.stringify(aliceView.state?.spectators),
);

// ── online list (graded: clients learn about other connected clients) ───────
section('online list');

await sleep(200);
const online = aliceLobbyView.latest?.online ?? [];
const onlineNamed = (n) => online.find((p) => p.nickname === n);
check('players receive the online list', online.length >= 4, `${online.length} online`);
check(
  'the online list names the other players',
  ['Bob', 'Carol', 'Dave'].every((n) => onlineNamed(n)),
  online.map((p) => p.nickname).join(', '),
);
check(
  'a player in a live match shows as playing in that room',
  onlineNamed('Bob')?.status === 'playing' && onlineNamed('Bob')?.roomId === roomId,
  `${onlineNamed('Bob')?.status} ${onlineNamed('Bob')?.roomId}`,
);
check('a spectator shows as watching', onlineNamed('Carol')?.status === 'watching', onlineNamed('Carol')?.status);
check('guests are marked as guests', onlineNamed('Bob')?.isGuest === true);
check('the online list never carries a network address', online.every((p) => !('address' in p)));

const nameless = await connect();
await sleep(250);
check(
  'a socket without a nickname is not listed',
  !(aliceLobbyView.latest?.online ?? []).some((p) => p.id === nameless.id),
);
nameless.close();

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
  let lobby = null;
  p1.on('lobby:rooms', (payload) => (lobby = payload));
  await setName(p1, 'Fern');
  await setName(p2, 'Gus');
  await sleep(300);
  const names = (lobby?.online ?? []).map((p) => p.nickname);
  check('the lobby tells each client who else is online',
    names.includes('Fern') && names.includes('Gus') && !names.includes('(joining…)'),
    `${names.length} online`);
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

// ── reconnect grace period ─────────────────────────────────────────────────
section('reconnect grace period');

{
  const withSession = (sessionId) =>
    new Promise((resolve, reject) => {
      const socket = io(URL, { transports: ['websocket'], forceNew: true, auth: { sessionId } });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  const S1 = 'smoke-session-aaaaaaaaaaaaaaaa';
  const S2 = 'smoke-session-bbbbbbbbbbbbbbbb';

  const host = await withSession(S1);
  let guest = await withSession(S2);
  await setName(host, 'Hana');
  await setName(guest, 'Ivo');
  const hostView = track(host);
  const forfeits = [];
  host.on('match:forfeit', (n) => forfeits.push(n));

  const room = await emitAck(host, 'room:create', { name: 'Grace', config: CLASSIC });
  await emitAck(guest, 'room:join', { roomId: room.roomId });
  host.emit('game:start');
  await sleep(400);

  guest.close();
  await sleep(400);
  const away = hostView.state?.players.find((p) => p.nickname === 'Ivo');
  check('a dropped player keeps their seat, marked disconnected',
    away && away.connected === false && hostView.state?.status === 'playing',
    away ? `connected=${away.connected}, ${hostView.state?.status}` : 'seat gone');
  check('no forfeit while the seat is held', forfeits.length === 0);

  guest = await withSession(S2);
  const guestView = track(guest);
  const rejoin = await setName(guest, 'Ivo');
  await sleep(400);
  check('reconnecting with the same session resumes the room', rejoin.roomId === room.roomId,
    String(rejoin.roomId));
  const back = hostView.state?.players.find((p) => p.nickname === 'Ivo');
  check('the resumed seat is live under the new connection',
    back?.id === guest.id && back?.connected === true && guestView.state?.roomId === room.roomId);
  check('the match carried on through the reconnect', hostView.state?.status === 'playing',
    hostView.state?.status);

  guest.close();
  console.log('  …waiting out the grace period');
  await sleep(31000);
  check('not coming back within the grace period forfeits the match',
    forfeits[0]?.winnerNickname === 'Hana', forfeits[0] ? `winner ${forfeits[0].winnerNickname}` : 'no forfeit');

  host.close();
}

// ── reconnect grace meets moderation ────────────────────────────────────────
section('reconnect meets moderation');

{
  const withSession = (sessionId) =>
    new Promise((resolve, reject) => {
      const socket = io(URL, { transports: ['websocket'], forceNew: true, auth: { sessionId } });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  // Three seats makes it a Custom casual room, where the host may kick.
  const CUSTOM = { ...CLASSIC, maxPlayers: 3 };

  // The same tab coming back as someone else must not inherit the seat.
  {
    const host = await withSession('smoke-session-cccccccccccccccc');
    let other = await withSession('smoke-session-dddddddddddddddd');
    await setName(host, 'Jun');
    await setName(other, 'Kai');
    const forfeits = [];
    host.on('match:forfeit', (n) => forfeits.push(n));
    const room = await emitAck(host, 'room:create', { name: 'Swap', config: CLASSIC });
    await emitAck(other, 'room:join', { roomId: room.roomId });
    host.emit('game:start');
    await sleep(400);

    other.close();
    await sleep(300);
    other = await withSession('smoke-session-dddddddddddddddd');
    const swapped = await setName(other, 'Lee');
    await sleep(400);
    check('a tab that comes back as someone else does not take the held seat',
      swapped.ok === true && !swapped.roomId, String(swapped.roomId));
    check('the held seat is given up at once instead — a forfeit mid-match',
      forfeits[0]?.leaverNickname === 'Kai' && forfeits[0]?.winnerNickname === 'Jun',
      forfeits[0] ? `${forfeits[0].winnerNickname} won` : 'no forfeit');
    host.close();
    other.close();
  }

  // Kicking a player whose seat is being held gives the seat up.
  {
    const host = await withSession('smoke-session-eeeeeeeeeeeeeeee');
    let victim = await withSession('smoke-session-ffffffffffffffff');
    await setName(host, 'Mia');
    const victimJoin = await setName(victim, 'Ned');
    const hostView = track(host);
    const forfeits = [];
    host.on('match:forfeit', (n) => forfeits.push(n));
    const room = await emitAck(host, 'room:create', { name: 'Held kick', config: CUSTOM });
    await emitAck(victim, 'room:join', { roomId: room.roomId });
    host.emit('game:start');
    await sleep(400);

    victim.close();
    await sleep(300);
    const kicked = await emitAck(host, 'room:kick', {
      targetId: victimJoin.playerId,
      ban: false,
      note: REASON,
    });
    await sleep(300);
    check('the host can kick a player whose seat is being held', kicked.ok === true,
      kicked.error ?? '');
    check('the kick frees the held seat and counts as a forfeit mid-match',
      !hostView.state?.players.some((p) => p.id === victimJoin.playerId) &&
        forfeits[0]?.leaverNickname === 'Ned',
      forfeits[0] ? `${forfeits[0].winnerNickname} won` : 'no forfeit');

    victim = await withSession('smoke-session-ffffffffffffffff');
    const back = await setName(victim, 'Ned');
    check('a kicked player coming back does not get the seat back', !back.roomId,
      String(back.roomId));
    host.close();
    victim.close();
  }

  // An admin kick mid-match is a forfeit too: the player left behind wins.
  {
    const p1 = await connect();
    const p2 = await connect();
    await setName(p1, 'Ola');
    const p2Join = await setName(p2, 'Pim');
    const forfeits = [];
    p1.on('match:forfeit', (n) => forfeits.push(n));
    const room = await emitAck(p1, 'room:create', { name: 'Admin forfeit', config: CLASSIC });
    await emitAck(p2, 'room:join', { roomId: room.roomId });
    p1.emit('game:start');
    await sleep(400);

    const removedNotice = waitFor(p2, 'player:removed', 3000).catch(() => null);
    const adminKicked = await emitAck(admin, 'admin:kick', { clientId: p2Join.playerId, note: REASON });
    const notice = await removedNotice;
    await sleep(300);
    check('an admin kick mid-match hands the other player a forfeit win',
      adminKicked.ok === true && notice?.kind === 'kicked' && forfeits[0]?.winnerNickname === 'Ola',
      forfeits[0] ? `${forfeits[0].winnerNickname} won` : adminKicked.error ?? 'no forfeit');
    p1.close();
    p2.close();
  }
}

// ── host moderation ─────────────────────────────────────────────────────────
section('host moderation');

const modRoom = await emitAck(alice, 'room:create', {
  name: 'Moderated',
  config: { ...CLASSIC, maxPlayers: 3 },
});
await emitAck(bob, 'room:join', { roomId: modRoom.roomId });
await emitAck(carol, 'room:join', { roomId: modRoom.roomId });
await emitAck(dave, 'room:spectate', { roomId: modRoom.roomId });
await sleep(150);

const kick = (by, targetId, ban = false, note = REASON) =>
  emitAck(by, 'room:kick', { targetId, ban, note });

const byNonHost = await kick(carol, bobJoin.playerId);
check('a non-host cannot kick', byNonHost.ok === false, byNonHost.error ?? '');

const noReason = await kick(alice, bobJoin.playerId, false, { reasons: [], remark: '' });
check('a kick without a reason is refused', noReason.ok === false, noReason.error ?? '');

const kickSelf = await kick(alice, aliceJoin.playerId);
check('the host cannot kick themselves', kickSelf.ok === false, kickSelf.error ?? '');

const bobKicked = waitFor(bob, 'player:removed', 3000).catch(() => null);
const hostKick = await kick(alice, bobJoin.playerId);
const bobNotice = await bobKicked;
check('the host can kick in a casual room', hostKick.ok === true, hostKick.error ?? '');
check(
  'the kicked player is told who and why',
  bobNotice?.kind === 'kicked' &&
    bobNotice.by === 'host' &&
    bobNotice.byName === 'Alice' &&
    bobNotice.note.reasons[0] === 'afk' &&
    bobNotice.note.remark === 'smoke test',
  JSON.stringify(bobNotice),
);
await sleep(150);
check(
  'the kicked player is out of the room',
  !aliceView.state?.players.some((p) => p.id === bobJoin.playerId),
);
const bobBack = await emitAck(bob, 'room:join', { roomId: modRoom.roomId });
check('a kicked player may rejoin', bobBack.ok === true, bobBack.errors?.[0] ?? '');

const carolKicked = waitFor(carol, 'player:removed', 3000).catch(() => null);
const hostBan = await kick(alice, carolJoin.playerId, true, { reasons: ['cheating'], remark: '' });
const carolNotice = await carolKicked;
check('the host can ban from the room', hostBan.ok === true && carolNotice?.roomBan === true,
  JSON.stringify(carolNotice));
const carolRejoin = await emitAck(carol, 'room:join', { roomId: modRoom.roomId });
check('a room-banned player cannot rejoin', carolRejoin.ok === false, carolRejoin.errors?.[0] ?? '');
const carolSpectate = await emitAck(carol, 'room:spectate', { roomId: modRoom.roomId });
check('a room-banned player cannot spectate either', carolSpectate.ok === false);

const daveKicked = waitFor(dave, 'player:removed', 3000).catch(() => null);
const specKick = await kick(alice, daveJoin.playerId);
check('the host can kick a spectator', specKick.ok === true && Boolean(await daveKicked));

const modStarted = waitFor(alice, 'match:start', 4000).catch(() => null);
alice.emit('game:start');
await modStarted;
const bobMidMatch = waitFor(bob, 'player:removed', 3000).catch(() => null);
const midKick = await kick(alice, bobJoin.playerId);
await bobMidMatch;
await sleep(200);
check(
  'kicking the only opponent mid-match abandons it, as if they had left',
  midKick.ok === true && aliceView.state?.status === 'waiting',
  aliceView.state?.status,
);
alice.emit('room:leave');
await sleep(200);

const rankedRoom = await emitAck(alice, 'room:create', {
  name: 'Ranked',
  config: { ...CLASSIC, mode: 'ranked' },
});
await emitAck(bob, 'room:join', { roomId: rankedRoom.roomId });
const rankedKick = await kick(alice, bobJoin.playerId);
check('the host cannot kick in a ranked room', rankedKick.ok === false, rankedKick.error ?? '');
for (const socket of [alice, bob]) socket.emit('room:leave');
await sleep(200);

const aliceRematched = waitFor(alice, 'queue:matched', 8000).catch(() => null);
const bobRematched = waitFor(bob, 'queue:matched', 8000).catch(() => null);
alice.emit('queue:join', { mode: 'casual' });
bob.emit('queue:join', { mode: 'casual' });
await Promise.all([aliceRematched, bobRematched]);
await sleep(300);
const matchedHost = aliceView.state?.hostId;
const matchedHostSocket = matchedHost === aliceJoin.playerId ? alice : bob;
const matchedOther = matchedHost === aliceJoin.playerId ? bobJoin.playerId : aliceJoin.playerId;
const matchmadeKick = await kick(matchedHostSocket, matchedOther);
check('the host cannot kick in a matchmade room', matchmadeKick.ok === false, matchmadeKick.error ?? '');
for (const socket of [alice, bob]) socket.emit('room:leave');
await sleep(300);

// ── join requests ───────────────────────────────────────────────────────────
section('join requests');

// A malformed request must be refused, not take the server down.
const noPayload = await emitAck(bob, 'room:requestJoin', undefined);
check('a request without a payload is refused cleanly',
  noPayload.ok === false && !String(noPayload.error).startsWith('no ack'), noPayload.error ?? '');

const askRoom = await emitAck(alice, 'room:create', {
  name: 'Ask first',
  config: { rows: 6, cols: 6, mineCount: 10, maxPlayers: 3, joinByRequest: true },
});
await sleep(150);
check('an ask-to-join room can be created',
  askRoom.ok === true && aliceView.state?.config.joinByRequest === true,
  JSON.stringify(aliceView.state?.config));

const directJoin = await emitAck(bob, 'room:join', { roomId: askRoom.roomId });
check('joining an ask-to-join room directly is refused', directJoin.ok === false,
  directJoin.errors?.[0] ?? '');

const bobAsks = await emitAck(bob, 'room:requestJoin', { roomId: askRoom.roomId });
await sleep(150);
check('a player can ask to join', bobAsks.ok === true, bobAsks.error ?? '');
check('the host sees who is asking',
  aliceView.state?.joinRequests?.some((r) => r.id === bobJoin.playerId && r.nickname === 'Bob'),
  JSON.stringify(aliceView.state?.joinRequests));

const bobAsksAgain = await emitAck(bob, 'room:requestJoin', { roomId: askRoom.roomId });
check('a duplicate request is refused', bobAsksAgain.ok === false, bobAsksAgain.error ?? '');

bob.emit('room:cancelRequest');
await sleep(150);
check('cancelling withdraws the request',
  !aliceView.state?.joinRequests?.some((r) => r.id === bobJoin.playerId));

await emitAck(bob, 'room:requestJoin', { roomId: askRoom.roomId });
await emitAck(dave, 'room:requestJoin', { roomId: askRoom.roomId });
await sleep(150);

const nonHostAnswer = await emitAck(dave, 'room:answerRequest', {
  requesterId: bobJoin.playerId,
  accept: true,
});
check('only the host can answer a request', nonHostAnswer.ok === false, nonHostAnswer.error ?? '');

// The client follows only a room it knows it is in, so "accepted" must arrive
// before the room's first state:sync — or that snapshot is ignored.
const bobOrder = [];
const noteResolved = () => bobOrder.push('resolved');
const noteSync = (s) => {
  if (s.roomId === askRoom.roomId) bobOrder.push('sync');
};
bob.on('room:requestResolved', noteResolved);
bob.on('state:sync', noteSync);
const bobResolved = waitFor(bob, 'room:requestResolved', 3000).catch(() => null);
const acceptBob = await emitAck(alice, 'room:answerRequest', {
  requesterId: bobJoin.playerId,
  accept: true,
});
const bobOutcome = await bobResolved;
await sleep(150);
bob.off('room:requestResolved', noteResolved);
bob.off('state:sync', noteSync);
check('the host can accept, and the requester is told',
  acceptBob.ok === true && bobOutcome?.outcome === 'accepted' && bobOutcome.byName === 'Alice',
  JSON.stringify(bobOutcome));
check('the requester hears "accepted" before the room’s state',
  bobOrder[0] === 'resolved' && bobOrder.includes('sync'), bobOrder.join(' → '));
check('an accepted player is seated',
  aliceView.state?.players.some((p) => p.id === bobJoin.playerId));
check('an answered request leaves the list',
  !aliceView.state?.joinRequests?.some((r) => r.id === bobJoin.playerId));

const daveResolved = waitFor(dave, 'room:requestResolved', 3000).catch(() => null);
const declineDave = await emitAck(alice, 'room:answerRequest', {
  requesterId: daveJoin.playerId,
  accept: false,
});
const daveOutcome = await daveResolved;
await sleep(150);
check('the host can decline, and the requester is told',
  declineDave.ok === true && daveOutcome?.outcome === 'declined', JSON.stringify(daveOutcome));
check('a declined player is not seated',
  !aliceView.state?.players.some((p) => p.id === daveJoin.playerId));

const daveWatches = await emitAck(dave, 'room:spectate', { roomId: askRoom.roomId });
check('spectating an ask-to-join room needs no request',
  daveWatches.ok === true && daveWatches.seat === 'spectator', daveWatches.errors?.[0] ?? '');

const askStarted = waitFor(alice, 'match:start', 4000).catch(() => null);
alice.emit('game:start');
const askStart = await askStarted;
check('a spectator is not moved into a free seat without the host’s approval',
  Boolean(askStart) && !askStart.players.some((p) => p.id === daveJoin.playerId),
  askStart ? askStart.players.map((p) => p.nickname).join(', ') : 'match did not start');
dave.emit('room:leave');
await sleep(150);

await emitAck(carol, 'room:requestJoin', { roomId: askRoom.roomId });
const carolResolved = waitFor(carol, 'room:requestResolved', 3000).catch(() => null);
for (const socket of [alice, bob]) socket.emit('room:leave');
const carolOutcome = await carolResolved;
check('a pending request is told when the room closes', carolOutcome?.outcome === 'closed',
  JSON.stringify(carolOutcome));
await sleep(200);

// ── Classic keeps the original assignment rules ─────────────────────────────
section('Classic stays original');

const classicRoom = await emitAck(alice, 'room:create', {
  name: 'Classic',
  config: { ...CLASSIC, joinByRequest: true },
});
await sleep(150);
check('a Classic room is always open to join, whatever the client asked',
  aliceView.state?.config.joinByRequest === false);
const classicJoin = await emitAck(bob, 'room:join', { roomId: classicRoom.roomId });
check('players join a Classic room directly', classicJoin.ok === true && classicJoin.seat === 'player');
const classicKick = await kick(alice, bobJoin.playerId);
check('the host cannot kick in a Classic room', classicKick.ok === false, classicKick.error ?? '');
for (const socket of [alice, bob]) socket.emit('room:leave');
await sleep(200);

// ── admin: viewer, mine toggle, kick, ban, end game ─────────────────────────
section('admin moderation');

let adminView = 'unset';
admin.on('admin:room', (view) => {
  adminView = view;
});

const watched = await emitAck(alice, 'room:create', { name: 'Watched', config: CLASSIC });
await emitAck(bob, 'room:join', { roomId: watched.roomId });
admin.emit('admin:watch', { roomId: watched.roomId });
await sleep(300);
check('the admin viewer receives the watched room', adminView?.state?.roomId === watched.roomId);
check('mines stay hidden until the toggle is on', adminView?.mines === null);

admin.emit('admin:mines', { show: true });
await sleep(200);
check('before a match there are no mines to show', adminView?.mines?.length === 0,
  JSON.stringify(adminView?.mines));

const watchedStarted = waitFor(alice, 'match:start', 4000).catch(() => null);
alice.emit('game:start');
await watchedStarted;
await sleep(300);
check('with the toggle on the admin sees all 11 mines', adminView?.mines?.length === 11,
  String(adminView?.mines?.length));
check('players still never receive mine positions', !JSON.stringify(aliceView.state).includes('"mines"'));

const onTurn = aliceView.state?.currentPlayerId === aliceJoin.playerId ? alice : bob;
const mineRevealed = waitFor(alice, 'cell:revealed', 3000).catch(() => null);
onTurn.emit('game:reveal', adminView?.mines?.[0] ?? { row: 0, col: 0 });
const revealedMine = await mineRevealed;
check('the mine positions the admin sees are real', revealedMine?.cell.kind === 'bomb',
  revealedMine?.cell.kind ?? 'no reveal');

admin.emit('admin:mines', { show: false });
await sleep(200);
check('turning the toggle off hides the mines again', adminView?.mines === null);

const adminNoNote = await emitAck(admin, 'admin:kick', {
  clientId: bobJoin.playerId,
  note: { reasons: [], remark: '' },
});
check('an admin kick needs a reason too', adminNoNote.ok === false);

const ghostKick = await emitAck(admin, 'admin:kick', { clientId: 'no-such-client', note: REASON });
check('kicking a client that is gone fails cleanly', ghostKick.ok === false, ghostKick.error ?? '');

const bobAdminKicked = waitFor(bob, 'player:removed', 3000).catch(() => null);
const adminKick = await emitAck(admin, 'admin:kick', { clientId: bobJoin.playerId, note: REASON });
const bobAdminNotice = await bobAdminKicked;
check('the admin can kick a player out of a live match',
  adminKick.ok === true && bobAdminNotice?.kind === 'kicked' && bobAdminNotice.by === 'admin',
  JSON.stringify(bobAdminNotice));
await sleep(200);
check('a kicked player stays connected', bob.connected === true);
check('the viewer reflects the kick',
  !adminView?.state?.players.some((p) => p.id === bobJoin.playerId));

const carolBanned = waitFor(carol, 'player:removed', 3000).catch(() => null);
const carolDropped = waitFor(carol, 'disconnect', 3000).catch(() => null);
const adminBan = await emitAck(admin, 'admin:ban', {
  clientId: carolJoin.playerId,
  note: { reasons: ['harassment'], remark: 'smoke test ban' },
});
const carolBanNotice = await carolBanned;
const carolReason = await carolDropped;
check('the admin can ban', adminBan.ok === true && carolBanNotice?.kind === 'banned',
  JSON.stringify(carolBanNotice));
check('a banned client is disconnected by the server', carolReason === 'io server disconnect',
  String(carolReason));

const aliceEnded = waitFor(alice, 'player:removed', 3000).catch(() => null);
const closeRoom = await emitAck(admin, 'admin:closeRoom', {
  roomId: watched.roomId,
  note: { reasons: ['other'], remark: 'closing time' },
});
const aliceEndedNotice = await aliceEnded;
await sleep(300);
check('the admin can end a game', closeRoom.ok === true && aliceEndedNotice?.kind === 'room-closed',
  JSON.stringify(aliceEndedNotice));
check('an ended game leaves the room list', !latestAdmin?.rooms.some((r) => r.id === watched.roomId));
check('the viewer is told the watched room is gone', adminView === null, JSON.stringify(adminView));

const emptied = await emitAck(bob, 'room:create', { name: 'Empties', config: CLASSIC });
admin.emit('admin:watch', { roomId: emptied.roomId });
await sleep(200);
bob.emit('room:leave');
await sleep(300);
check('the viewer is told when a watched room empties out', adminView === null,
  JSON.stringify(adminView));

// ── the console's terminal feed ─────────────────────────────────────────────
section('terminal log');

check('the log records connections', adminLog.some((l) => l.kind === 'connection' && /connect/.test(l.text)));
check('the log records disconnects with their reason',
  adminLog.some((l) => l.kind === 'connection' && l.text.includes('Carol') && /disconnect/.test(l.text)));
check('the log records moderation with its reason',
  adminLog.some((l) => l.kind === 'moderation' && l.text.includes('smoke test')));
check('the log carries game traffic', adminLog.some((l) => l.kind === 'traffic' && l.text.includes('game:reveal')));

// ── admin access ────────────────────────────────────────────────────────────
section('admin access');

// A tunnel or proxy adds a forwarding header; with no admin account behind it,
// the console must refuse even though the TCP peer is localhost.
const remoteConsole = (auth = {}) =>
  new Promise((resolve) => {
    const socket = io(URL + ADMIN_NS, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { 'x-forwarded-for': '203.0.113.9' },
      auth,
    });
    const done = (result) => {
      socket.close();
      resolve(result);
    };
    socket.once('connect', () => done('connected'));
    socket.once('connect_error', (err) => done(err.message));
    setTimeout(() => done('timeout'), 4000);
  });
const remoteAttempt = await remoteConsole();
check('a remote console connection without an admin account is refused',
  remoteAttempt === 'ADMIN_ONLY', remoteAttempt);

// With no ADMIN_TOKEN configured the token route is closed — an unset token
// must never read as "open to everyone", whatever the handshake carries.
if (!process.env.ADMIN_TOKEN) {
  const emptyToken = await remoteConsole({ token: '' });
  const guessedToken = await remoteConsole({ token: 'guess' });
  check('with no ADMIN_TOKEN set, no token opens the console remotely',
    emptyToken === 'ADMIN_ONLY' && guessedToken === 'ADMIN_ONLY', `${emptyToken}, ${guessedToken}`);
}

// ── malformed messages never take the server down ───────────────────────────
section('malformed messages');

// Anyone on the network can send anything. Each event gets missing, wrong-type
// and hostile payloads, plus a non-function where an acknowledgement goes.
const CLIENT_EVENTS = [
  'player:join', 'room:create', 'room:join', 'room:spectate', 'room:leave',
  'room:requestJoin', 'room:cancelRequest', 'room:answerRequest', 'room:kick',
  'queue:join', 'queue:leave', 'game:start', 'game:reveal', 'game:rematch',
];
const ADMIN_EVENTS = ['admin:kick', 'admin:ban', 'admin:closeRoom', 'admin:watch', 'admin:mines'];
const BAD_ARGS = [
  [], [undefined], [null], [42], ['text'], [[]], [{}],
  [{ roomId: {}, nickname: {}, name: [], config: 'x', mode: 7, row: 'a', col: null, targetId: [], note: 'x' }],
  [{}, 5], [null, 'not a function'],
];

const fuzzer = await connect();
const fuzz = (socket, events) => {
  for (const event of events) for (const args of BAD_ARGS) socket.emit(event, ...args);
};
fuzz(fuzzer, CLIENT_EVENTS);
// A named player in a room reaches deeper code than an anonymous one.
fuzzer.emit('player:join', { nickname: 'Fuzz' });
fuzzer.emit('room:create', { name: 'Fuzz room', config: { rows: 4, cols: 4, mineCount: 2, maxPlayers: 3 } });
await sleep(300);
fuzz(fuzzer, CLIENT_EVENTS);
fuzz(admin, ADMIN_EVENTS);
await sleep(1000);

const survivor = await connect().catch(() => null);
const survivorJoin = survivor ? await setName(survivor, 'Survivor') : null;
check('the server survives malformed messages on every event',
  survivorJoin?.welcome === 'Welcome, Survivor.', survivorJoin?.welcome ?? 'could not connect');
const badJoin = survivor ? await emitAck(survivor, 'room:join', null) : { ok: false, error: 'no ack' };
check('a malformed request still gets a real answer',
  badJoin.ok === false && !String(badJoin.error ?? '').startsWith('no ack'), JSON.stringify(badJoin));
check('the server console survives malformed messages too', admin.connected === true);

for (const socket of [alice, bob, carol, dave, admin, fuzzer, survivor]) socket?.close();

console.log(`\n${passed.length} passed, ${failed.length} failed\n`);
if (failed.length > 0) {
  failed.forEach((name) => console.log(`  x ${name}`));
  process.exit(1);
}
process.exit(0);
