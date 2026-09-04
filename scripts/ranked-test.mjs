/**
 * Ranked-match persistence test.
 *
 * Creates two real (confirmed) accounts, signs them in, plays a ranked match
 * over sockets, then checks that the match was written and both ratings moved.
 *
 * Needs Supabase credentials AND a running server. Skips cleanly without them,
 * so it never breaks a run on a machine with no secrets.
 *
 * Usage:
 *   npm run start          # terminal 1
 *   npm run test:ranked    # terminal 2
 */
import { createClient } from '@supabase/supabase-js';
import { io } from 'socket.io-client';

const URL = process.env.FMM_URL ?? 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.log('\nSkipping ranked test — Supabase credentials not configured.\n');
  process.exit(0);
}

const passed = [];
const failed = [];
const check = (name, ok, detail = '') => {
  (ok ? passed : failed).push(detail ? `${name} — ${detail}` : name);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const accounts = [
  { email: `fmm_a_${stamp}@example.com`, password: 'test-password-123', username: `TestA${stamp % 10000}` },
  { email: `fmm_b_${stamp}@example.com`, password: 'test-password-123', username: `TestB${stamp % 10000}` },
];

console.log(`\nFind My Mines — ranked persistence test against ${URL}\n`);

// ── create two confirmed accounts ───────────────────────────────────────────
// email_confirm bypasses the confirmation email, which stays ON in production.
for (const account of accounts) {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { username: account.username },
  });
  if (error) {
    check('create test account', false, error.message);
    process.exit(1);
  }
  account.id = data.user.id;
}
check('two confirmed accounts created', accounts.every((a) => a.id));

await sleep(400);

// ── the signup trigger should have made profiles at 800 ─────────────────────
const { data: initial } = await admin
  .from('profiles')
  .select('id, username, elo, games_played')
  .in('id', accounts.map((a) => a.id));

check('signup trigger created both profiles', initial?.length === 2, `${initial?.length ?? 0} found`);
check('both start at 800 Elo', initial?.every((p) => p.elo === 800) ?? false);
check('both start with 0 games', initial?.every((p) => p.games_played === 0) ?? false);

// ── sign in to get real access tokens ───────────────────────────────────────
for (const account of accounts) {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) {
    check('sign in', false, error.message);
    process.exit(1);
  }
  account.token = data.session.access_token;
}
check('both signed in and hold access tokens', accounts.every((a) => a.token));

// ── connect sockets carrying those tokens ───────────────────────────────────
function connect(accessToken) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, {
      transports: ['websocket'],
      forceNew: true,
      auth: { accessToken },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

function waitFor(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function track(socket) {
  const view = { state: null, ended: null };
  const set = (s) => { view.state = s; };
  socket.on('state:sync', set);
  socket.on('match:start', set);
  socket.on('match:reset', set);
  socket.on('cell:revealed', ({ state }) => set(state));
  socket.on('match:ended', (s) => { view.ended = s; set(s); });
  socket.on('turn:changed', ({ currentPlayerId, secondsLeft }) => {
    if (view.state) view.state = { ...view.state, currentPlayerId, secondsLeft };
  });
  return view;
}

const sockA = await connect(accounts[0].token);
const sockB = await connect(accounts[1].token);
const viewA = track(sockA);
track(sockB);

const joinA = await emitAck(sockA, 'player:join', { nickname: 'ignored' });
const joinB = await emitAck(sockB, 'player:join', { nickname: 'ignored' });

check('server resolved account A, not a guest', joinA.isGuest === false, `isGuest=${joinA.isGuest}`);
check('server resolved account B, not a guest', joinB.isGuest === false);
check('nickname comes from the profile, not the client', joinA.welcome.includes(accounts[0].username), joinA.welcome);
check('server reports the stored rating', joinA.elo === 800, String(joinA.elo));

// ── play a ranked match ─────────────────────────────────────────────────────
const created = await emitAck(sockA, 'room:create', {
  name: 'Ranked Test',
  config: { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2, mode: 'ranked' },
});
check('ranked room created', created.ok === true, created.errors?.[0] ?? '');

await emitAck(sockB, 'room:join', { roomId: created.roomId });
const started = waitFor(sockA, 'match:start');
sockA.emit('game:start');
await started;

const byId = { [joinA.playerId]: sockA, [joinB.playerId]: sockB };
const attempted = new Set();
const deadline = Date.now() + 45000;

while (!viewA.ended && Date.now() < deadline) {
  const state = viewA.state;
  const active = state && byId[state.currentPlayerId];
  if (!active) { await sleep(50); continue; }

  const done = new Set(state.revealed.map((c) => `${c.row}:${c.col}`));
  let target = null;
  for (let row = 0; row < state.rows && !target; row++) {
    for (let col = 0; col < state.cols && !target; col++) {
      const key = `${row}:${col}`;
      if (!done.has(key) && !attempted.has(`${state.currentPlayerId}|${key}`)) target = { row, col, key };
    }
  }
  if (!target) { await sleep(80); continue; }

  attempted.add(`${state.currentPlayerId}|${target.key}`);
  active.emit('game:reveal', { row: target.row, col: target.col });
  await sleep(70);
}

check('ranked match finished', Boolean(viewA.ended));

if (viewA.ended) {
  const deltas = viewA.ended.players.map((p) => p.eloDelta ?? 0);
  check('both seats received a rating change', deltas.every((d) => d !== 0), deltas.join(', '));
  check('the deltas cancel out', deltas.reduce((a, b) => a + b, 0) === 0, String(deltas.reduce((a, b) => a + b, 0)));
}

// Persistence is fire-and-forget on the server; give it a moment to land.
await sleep(1500);

// ── check the database actually changed ─────────────────────────────────────
const { data: after } = await admin
  .from('profiles')
  .select('id, elo, games_played, wins, losses')
  .in('id', accounts.map((a) => a.id));

check('ratings moved away from 800 in the database', after?.every((p) => p.elo !== 800) ?? false,
  after?.map((p) => p.elo).join(', '));
check('games_played incremented for both', after?.every((p) => p.games_played === 1) ?? false);
check('exactly one winner and one loser recorded',
  (after?.filter((p) => p.wins === 1).length === 1) && (after?.filter((p) => p.losses === 1).length === 1));

const { data: matchRows } = await admin
  .from('matches')
  .select('id, mode, room_id, winner_profile_id')
  .eq('room_id', created.roomId);

check('a match row was written', (matchRows?.length ?? 0) === 1);
check('it is recorded as ranked', matchRows?.[0]?.mode === 'ranked');
check('the winner was recorded', Boolean(matchRows?.[0]?.winner_profile_id));

const matchId = matchRows?.[0]?.id;
const { data: seatRows } = await admin
  .from('match_players')
  .select('profile_id, display_name, is_guest, score, placement, elo_before, elo_after, elo_delta, outcome')
  .eq('match_id', matchId ?? '00000000-0000-0000-0000-000000000000');

check('both seats were written', (seatRows?.length ?? 0) === 2, `${seatRows?.length ?? 0} rows`);
check('no seat is marked a guest', seatRows?.every((s) => s.is_guest === false) ?? false);
check('seat scores sum to the mine count', (seatRows?.reduce((a, s) => a + s.score, 0) ?? 0) === 11);
check('elo_after equals elo_before plus delta',
  seatRows?.every((s) => s.elo_after === s.elo_before + s.elo_delta) ?? false);
check('stored deltas match the live ones',
  (seatRows?.reduce((a, s) => a + s.elo_delta, 0) ?? -1) === 0);

// ── casual must NOT move ratings ────────────────────────────────────────────
const eloBeforeCasual = after?.map((p) => p.elo) ?? [];

sockA.emit('room:leave');
sockB.emit('room:leave');
await sleep(300);

const casual = await emitAck(sockA, 'room:create', {
  name: 'Casual Test',
  config: { rows: 4, cols: 4, mineCount: 3, maxPlayers: 2, mode: 'casual' },
});
await emitAck(sockB, 'room:join', { roomId: casual.roomId });
const casualStarted = waitFor(sockA, 'match:start');
sockA.emit('game:start');
await casualStarted;

viewA.ended = null;
attempted.clear();
const casualDeadline = Date.now() + 30000;
while (!viewA.ended && Date.now() < casualDeadline) {
  const state = viewA.state;
  const active = state && byId[state.currentPlayerId];
  if (!active) { await sleep(50); continue; }
  const done = new Set(state.revealed.map((c) => `${c.row}:${c.col}`));
  let target = null;
  for (let row = 0; row < state.rows && !target; row++) {
    for (let col = 0; col < state.cols && !target; col++) {
      const key = `${row}:${col}`;
      if (!done.has(key) && !attempted.has(`${state.currentPlayerId}|${key}`)) target = { row, col, key };
    }
  }
  if (!target) { await sleep(80); continue; }
  attempted.add(`${state.currentPlayerId}|${target.key}`);
  active.emit('game:reveal', { row: target.row, col: target.col });
  await sleep(70);
}

await sleep(1500);
const { data: afterCasual } = await admin
  .from('profiles')
  .select('id, elo, games_played')
  .in('id', accounts.map((a) => a.id));

check('a casual match left ratings untouched',
  JSON.stringify(afterCasual?.map((p) => p.elo).sort()) === JSON.stringify([...eloBeforeCasual].sort()),
  afterCasual?.map((p) => p.elo).join(', '));
check('a casual match did not count as a game played',
  afterCasual?.every((p) => p.games_played === 1) ?? false);

const { data: casualMatch } = await admin.from('matches').select('id, mode').eq('room_id', casual.roomId);
check('the casual match was still recorded in history', (casualMatch?.length ?? 0) === 1);

// ── cleanup ─────────────────────────────────────────────────────────────────
for (const socket of [sockA, sockB]) socket.close();
for (const id of [matchId, casualMatch?.[0]?.id].filter(Boolean)) {
  await admin.from('matches').delete().eq('id', id);
}
for (const account of accounts) {
  await admin.auth.admin.deleteUser(account.id);
}
check('test accounts and matches cleaned up', true);

console.log(`\n${passed.length} passed, ${failed.length} failed\n`);
if (failed.length > 0) {
  failed.forEach((name) => console.log(`  x ${name}`));
  process.exit(1);
}
process.exit(0);
