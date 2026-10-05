/**
 * End-to-end smoke test over real sockets.
 *
 * Connects clients to a RUNNING server and exercises the full flow: nickname,
 * lobby, the online list, room creation, host start, a complete match,
 * rematch, leaving, forfeits, the reconnect grace period, host succession,
 * room cleanup, host and admin moderation, the admin console (viewer,
 * mine toggle, terminal log, access check), and the link-preview cards a
 * pasted /join or /u link unfurls into (needs the built client).
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
  // `replays` collects every match:replay, noting whether the match was already
  // over (ended, or forfeited) when it arrived: it must never come earlier.
  const view = { state: null, ended: null, closed: null, forfeited: false, replays: [] };
  const set = (s) => {
    view.state = s;
  };
  socket.on('state:sync', set);
  socket.on('match:start', (s) => {
    view.ended = null;
    view.forfeited = false;
    set(s);
  });
  socket.on('match:reset', set);
  socket.on('cell:revealed', ({ state }) => set(state));
  socket.on('match:ended', (s) => {
    view.ended = s;
    set(s);
  });
  socket.on('match:forfeit', () => {
    view.forfeited = true;
  });
  socket.on('match:replay', (payload) => {
    view.replays.push({ payload, afterEnd: view.ended !== null || view.forfeited });
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
// Player reports arrive on connect too, and again whenever one changes.
let firstReports = null;
admin.once('admin:reports', (list) => {
  firstReports = list;
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
await sleep(50);
check('admin console receives the player reports on connect', Array.isArray(firstReports),
  firstReports === null ? 'no admin:reports' : `${firstReports.length} report(s)`);

// Keep the newest snapshot around. Waiting for a *fresh* push is unreliable at
// the end of the run, when nothing is changing any more.
let latestAdmin = firstAdminState;
admin.on('admin:state', (state) => {
  latestAdmin = state;
});

// ── plain HTTP ──────────────────────────────────────────────────────────────
section('http');

// The page, its assets and /health sit behind a per-address rate limit, which
// must leave normal use alone and say so in the standard headers.
const health = await fetch(`${URL}/health`).catch(() => null);
const healthBody = health?.ok ? await health.json().catch(() => null) : null;
check('/health answers', healthBody?.ok === true, health ? String(health.status) : 'no response');
check('HTTP responses carry a RateLimit header', Boolean(health?.headers.get('ratelimit')),
  health?.headers.get('ratelimit') ?? 'missing');

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

// ── link previews ───────────────────────────────────────────────────────────
section('link previews');

// A chat app fetches a pasted link and draws its card from the page's <meta>
// tags. For /join/CODE and /u/NAME the server writes the room's or the
// player's own text into them; every other path goes out as built. Names are
// typed by people, so they must come out escaped. This reads the page the
// server really sends, which is the BUILT client: run `npm run build` first.
{
  const getPage = async (path) => {
    const res = await fetch(`${URL}${path}`);
    return { res, html: await res.text() };
  };
  const metaOf = (html, key) =>
    new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`).exec(html)?.[1] ?? '';
  const unescapeHtml = (text) =>
    text
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const metaCount = (html) => (html.match(/<meta /g) ?? []).length;

  const home = await getPage('/');
  const defaultTitle = metaOf(home.html, 'og:title');
  const defaultDescription = metaOf(home.html, 'og:description');
  check('the home page carries the default link card',
    home.res.status === 200 && Boolean(defaultTitle) && Boolean(defaultDescription) &&
      /\/og-image\.png$/.test(metaOf(home.html, 'og:image')) &&
      metaOf(home.html, 'twitter:card') === 'summary_large_image',
    `${home.res.status} "${defaultTitle}"`);

  const image = await fetch(`${URL}/og-image.png`);
  const png = Buffer.from(await image.arrayBuffer());
  check('/og-image.png is served as a 1200x630 PNG',
    image.status === 200 && /^image\/png/.test(image.headers.get('content-type') ?? '') &&
      png.length > 24 && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630,
    `${image.status} ${image.headers.get('content-type')} ${png.length > 24 ? `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` : 'too short'}`);

  const room = await getPage(`/join/${roomId}`);
  const roomTitle = unescapeHtml(metaOf(room.html, 'og:title'));
  const roomText = unescapeHtml(metaOf(room.html, 'og:description'));
  check('/join/CODE answers as HTML that is never cached',
    room.res.status === 200 && /^text\/html; charset=utf-8$/i.test(room.res.headers.get('content-type') ?? '') &&
      room.res.headers.get('cache-control') === 'no-cache',
    `${room.res.status} ${room.res.headers.get('content-type')} / ${room.res.headers.get('cache-control')}`);
  check('/join/CODE names the room in the card title', roomTitle === 'Join "Classic Room" · Find My Mines', roomTitle);
  check('/join/CODE says what kind of game it is',
    ["Alice's room", '6×6 board, 11 mines', '1 of 2 players', 'waiting to start'].every((part) => roomText.includes(part)),
    roomText);
  check('the page title, link and Twitter card follow the room',
    room.html.includes('<title>Join &quot;Classic Room&quot; · Find My Mines</title>') &&
      metaOf(room.html, 'og:url').endsWith(`/join/${roomId}`) &&
      unescapeHtml(metaOf(room.html, 'twitter:title')) === roomTitle &&
      unescapeHtml(metaOf(room.html, 'twitter:description')) === roomText,
    metaOf(room.html, 'og:url'));
  check('the room card still carries the app and the shared image',
    room.html.includes('<div id="root">') && metaOf(room.html, 'og:image') === metaOf(home.html, 'og:image') &&
      metaCount(room.html) === metaCount(home.html));

  const lower = await getPage(`/join/${roomId.toLowerCase()}`);
  check('a lowercase room code works, and the link is the canonical one',
    lower.res.status === 200 && unescapeHtml(metaOf(lower.html, 'og:title')) === roomTitle &&
      metaOf(lower.html, 'og:url').endsWith(`/join/${roomId}`),
    unescapeHtml(metaOf(lower.html, 'og:title')));

  const gone = await getPage('/join/ZZZZ');
  const goneTitle = unescapeHtml(metaOf(gone.html, 'og:title'));
  check('a room that does not exist gets the generic invitation',
    gone.res.status === 200 && /invited/i.test(goneTitle) && !goneTitle.includes('Classic Room'), goneTitle);

  const ghost = `nobody-${Date.now().toString(36)}`;
  const unknown = await getPage(`/u/${ghost}`);
  check('a player who does not exist gets the default card, without their name in it',
    unknown.res.status === 200 && metaOf(unknown.html, 'og:title') === defaultTitle &&
      metaOf(unknown.html, 'og:description') === defaultDescription && !unknown.html.includes(ghost),
    metaOf(unknown.html, 'og:title'));

  // A name typed by a person: markup, quotes and an ampersand. Eve makes the
  // rooms (a separate guest, so Alice stays in hers) and leaves them again.
  const eve = await connect();
  await setName(eve, 'Eve');
  const hostileName = `"><script>alert(1)</script>&'`;
  const hostileRoom = await emitAck(eve, 'room:create', { name: hostileName, config: CLASSIC });
  const hostile = hostileRoom.ok ? await getPage(`/join/${hostileRoom.roomId}`) : { res: { status: 0 }, html: '' };
  check('a room named with <script>, quotes and & is escaped in the card',
    hostileRoom.ok === true && hostile.res.status === 200 &&
      !hostile.html.includes('<script>alert(1)') &&
      hostile.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') &&
      unescapeHtml(metaOf(hostile.html, 'og:title')) === `Join "${hostileName}" · Find My Mines`,
    metaOf(hostile.html, 'og:title') || JSON.stringify(hostileRoom));
  check('the escaped card keeps every tag whole', metaCount(hostile.html) === metaCount(home.html),
    `${metaCount(hostile.html)} tags, home has ${metaCount(home.html)}`);

  // Creating another room leaves the first, which closes it: nobody is left in it.
  const hiddenRoom = await emitAck(eve, 'room:create', {
    name: 'Hidden lair',
    config: { rows: 5, cols: 5, mineCount: 4, maxPlayers: 3, mode: 'casual', private: true },
  });
  const hidden = hiddenRoom.ok ? await getPage(`/join/${hiddenRoom.roomId}`) : { res: { status: 0 }, html: '' };
  const hiddenTitle = unescapeHtml(metaOf(hidden.html, 'og:title'));
  check('a private room gets the generic invitation, with none of its details',
    hiddenRoom.ok === true && hidden.res.status === 200 && /invited/i.test(hiddenTitle) &&
      !hidden.html.includes('Hidden lair') && !hidden.html.includes('5×5'),
    hiddenTitle || JSON.stringify(hiddenRoom));

  const closed = hostileRoom.ok ? await getPage(`/join/${hostileRoom.roomId}`) : { res: { status: 0 }, html: '' };
  check('a room that has closed goes back to the generic invitation',
    closed.res.status === 200 && /invited/i.test(unescapeHtml(metaOf(closed.html, 'og:title'))) &&
      !closed.html.includes('script&gt;alert'),
    unescapeHtml(metaOf(closed.html, 'og:title')));

  // Leave nothing behind for the sections that follow.
  eve.emit('room:leave');
  await sleep(100);
  eve.close();
}

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
// The friends list finds friends by account id; a guest has none to find.
check(
  'online rows carry a profileId — null for a guest',
  ['Alice', 'Bob', 'Carol', 'Dave'].every((n) => onlineNamed(n)?.profileId === null),
  online.map((p) => `${p.nickname}:${p.profileId}`).join(', '),
);

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

// A row between two rows names no cell. It used to pass the bounds check and
// then throw inside the engine; it must be refused like any other bad move.
const fractionalMover = byId[aliceView.state?.currentPlayerId];
const revealedBefore = aliceView.state?.revealed.length ?? 0;
const fractionalReject = fractionalMover
  ? waitFor(fractionalMover, 'error:msg', 3000).catch(() => null)
  : null;
fractionalMover?.emit('game:reveal', { row: 2.5, col: 0 });
const fractional = await fractionalReject;
check('a fractional cell is refused as a bad move', fractional?.code === 'BAD_MOVE',
  fractional ? `${fractional.code}: ${fractional.message}` : 'no error');
await sleep(100);
check('a refused fractional cell uncovers nothing',
  (aliceView.state?.revealed.length ?? 0) === revealedBefore);

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

  // ── the replay: only after the match, and true to what happened ───────────
  await sleep(250);
  const replayMsg = aliceView.replays[0];
  const replay = replayMsg?.payload.replay;
  check('exactly one match:replay reached a player, and not before match:ended',
    aliceView.replays.length === 1 && replayMsg.afterEnd === true,
    `${aliceView.replays.length} received, afterEnd=${replayMsg?.afterEnd}`);
  check('the replay carries every mine: as many as the board has',
    Array.isArray(replay?.mines) && replay.mines.length === ended.bombCount && new Set(replay.mines).size === ended.bombCount,
    `${replay?.mines?.length} of ${ended.bombCount}`);
  check('every mine the players found is among the replay’s mines',
    ended.revealed.filter((c) => c.kind === 'bomb').every((c) => replay?.mines.includes(c.row * ended.cols + c.col)));
  check('the replay has one move per revealed cell, in the order they were opened',
    replay?.moves.length === ended.revealed.length &&
      ended.revealed.every((c, k) => replay.moves[k].i === c.row * ended.cols + c.col),
    `${replay?.moves?.length} moves, ${ended.revealed.length} revealed`);
  check('each move names the seat that made it',
    ended.revealed.every((c, k) => replay?.moves[k].s === ended.players.findIndex((p) => p.id === c.byPlayerId)));
  check('the replay’s seats are the players, in turn order',
    JSON.stringify(replay?.seats) === JSON.stringify(ended.players.map((p) => ({ name: p.nickname, bot: false }))),
    JSON.stringify(replay?.seats));
  check('the replay says the board size and mine count',
    replay?.v === 1 && replay.rows === ended.rows && replay.cols === ended.cols && replay.mineCount === ended.bombCount);
  check('the replay arrives with an id for the coach, no saved match yet unless there is a database',
    typeof replayMsg?.payload.replayId === 'string' && replayMsg.payload.replayId.length >= 16 &&
      (replayMsg.payload.matchId === null || typeof replayMsg.payload.matchId === 'string') &&
      typeof replayMsg.payload.coach === 'boolean' && replayMsg.payload.roomId === roomId);
  check('spectators get the replay too, after the end, and the same one',
    carolView.replays.length === 1 && carolView.replays[0].afterEnd === true &&
      JSON.stringify(carolView.replays[0].payload.replay) === JSON.stringify(replay));
  check('the match start, the moves and the end never carried the mines',
    !JSON.stringify(ended).includes('"mines"') && !JSON.stringify(start).includes('"mines"'));

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

// The leaderboard's "next" tag reads state.players as the turn order, so the
// server must hand the turn to the player after the current one in that list,
// wrapping at the end. A found mine keeps the turn, so only compare handovers.
const handovers = [];
let lastOnTurn = ffaStart?.currentPlayerId ?? null;
const onHandover = ({ currentPlayerId }) => {
  if (currentPlayerId === lastOnTurn) return;
  const order = (aliceView.state?.players ?? ffaStart?.players ?? []).map((p) => p.id);
  const expected = order[(order.indexOf(lastOnTurn) + 1) % order.length];
  handovers.push({ ok: order.includes(lastOnTurn) && currentPlayerId === expected });
  lastOnTurn = currentPlayerId;
};
alice.on('turn:changed', onHandover);

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

// Stop before the next section: players leaving can hand the turn elsewhere.
alice.off('turn:changed', onHandover);
const outOfOrder = handovers.filter((h) => !h.ok).length;
check(
  'the turn passes to the next player in state.players order',
  handovers.length > 0 && outOfOrder === 0,
  `${handovers.length} handovers, ${outOfOrder} out of order`,
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

// ── the player on turn leaving ─────────────────────────────────────────────
section('the player on turn leaving');

{
  const names = ['Quin', 'Rae', 'Sol', 'Tam'];
  const four = [];
  const ids = [];
  for (const name of names) {
    const socket = await connect();
    four.push(socket);
    ids.push((await setName(socket, name)).playerId);
  }
  const byId = Object.fromEntries(ids.map((id, i) => [id, four[i]]));
  const nameOf = (id) => names[ids.indexOf(id)] ?? id;
  // The first joiner is never the leaver below, so its view stays valid.
  const view = track(four[0]);

  const room = await emitAck(four[0], 'room:create', {
    name: 'Turn leaver',
    config: { ...CLASSIC, maxPlayers: 4 },
  });
  for (const socket of four.slice(1)) await emitAck(socket, 'room:join', { roomId: room.roomId });
  const began = waitFor(four[0], 'match:start', 6000).catch(() => null);
  four[0].emit('game:start');
  await began;
  await sleep(150);

  // The leaver must sit in the middle of the turn order: for the first or last
  // player, "the one after them" and "the first player left" are the same seat.
  const middleOnTurn = () => {
    const order = view.state?.players.map((p) => p.id) ?? [];
    const index = order.indexOf(view.state?.currentPlayerId);
    return index > 0 && index < order.length - 1;
  };
  const tried = new Set();
  for (let move = 0; move < 40 && !middleOnTurn(); move++) {
    const state = view.state;
    if (!state || state.status !== 'playing') break;
    const done = new Set(state.revealed.map((c) => `${c.row}:${c.col}`));
    let target = null;
    for (let row = 0; row < state.rows && !target; row++) {
      for (let col = 0; col < state.cols && !target; col++) {
        const key = `${row}:${col}`;
        if (!done.has(key) && !tried.has(key)) target = { row, col, key };
      }
    }
    if (!target) break;
    tried.add(target.key);
    byId[state.currentPlayerId]?.emit('game:reveal', { row: target.row, col: target.col });
    await sleep(150);
  }

  if (middleOnTurn()) {
    const order = view.state.players.map((p) => p.id);
    const leaverId = view.state.currentPlayerId;
    const expected = order[order.indexOf(leaverId) + 1];
    byId[leaverId].emit('room:leave');
    await sleep(400);
    check(
      'when the player on turn leaves, the turn goes to the player after them',
      view.state?.status === 'playing' && view.state?.currentPlayerId === expected,
      `${nameOf(leaverId)} left; expected ${nameOf(expected)}, got ${nameOf(view.state?.currentPlayerId)}`,
    );
  } else {
    check('when the player on turn leaves, the turn goes to the player after them', false,
      'never got a middle player on turn');
  }

  for (const socket of four) socket.close();
}

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

  // A forfeit ends the match too, so the replay comes then — and only then.
  const forfeitReplay = p1View.replays[0];
  const fr = forfeitReplay?.payload.replay;
  check('a forfeit sends the replay of the match, and only after the forfeit',
    p1View.replays.length === 1 && forfeitReplay.afterEnd === true && forfeitReplay.payload.roomId === room.roomId,
    `${p1View.replays.length} received, afterEnd=${forfeitReplay?.afterEnd}`);
  check('the forfeit replay has every mine, both seats and the moves made before the leaver walked out',
    fr?.mines?.length === 11 && fr.mineCount === 11 && fr.seats.map((s) => s.name).join() === 'Fern,Gus' &&
      Array.isArray(fr.moves) && fr.moves.length === 0,
    JSON.stringify({ mines: fr?.mines?.length, seats: fr?.seats, moves: fr?.moves?.length }));

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

// ── friend invites ──────────────────────────────────────────────────────────
section('friend invites');

// Inviting needs two signed-in accounts that are friends in the database, so
// the full path belongs with test:ranked. Without a database the wire must
// still turn every guest away, answer a garbage payload, and deliver nothing.
{
  const delivered = [];
  const noteInvite = (invite) => delivered.push(invite);
  alice.on('friend:invited', noteInvite);

  const fromLobby = await emitAck(bob, 'friend:invite', {
    profileId: '00000000-0000-4000-8000-000000000000',
  });
  check('a guest cannot invite friends',
    fromLobby.ok === false && /sign in/i.test(fromLobby.error ?? ''), fromLobby.error ?? '');

  const inviteRoom = await emitAck(bob, 'room:create', { name: 'Invites', config: CLASSIC });
  const fromRoom = await emitAck(bob, 'friend:invite', { profileId: aliceJoin.playerId });
  check('a guest in a room is still told to sign in',
    inviteRoom.ok === true && fromRoom.ok === false && /sign in/i.test(fromRoom.error ?? ''),
    fromRoom.error ?? '');

  const noPayloadInvite = await emitAck(bob, 'friend:invite', undefined);
  check('an invite without a payload is refused cleanly',
    noPayloadInvite.ok === false && !String(noPayloadInvite.error).startsWith('no ack'),
    noPayloadInvite.error ?? '');

  await sleep(200);
  check('a refused invite reaches nobody', delivered.length === 0, `${delivered.length} delivered`);
  alice.off('friend:invited', noteInvite);
  bob.emit('room:leave');
  await sleep(200);
}

// ── play vs AI ──────────────────────────────────────────────────────────────
section('play vs AI');

// Run against a server with no GROQ_API_KEY, so the bot plays on the solver
// alone and the run needs no network beyond the game server.
{
  const ann = await connect();
  const annJoin = await setName(ann, 'Ann');
  const annView = track(ann);
  const annLobby = trackLobby(ann);
  const outsider = await connect();
  await setName(outsider, 'Otto');
  const outsiderLobby = trackLobby(outsider);
  const overheard = [];
  outsider.on('room:message', (m) => overheard.push(m));

  const badLevel = await emitAck(ann, 'ai:play', { level: 'impossible', model: 'ai' });
  check('ai:play refuses a level that does not exist',
    badLevel.ok === false && Array.isArray(badLevel.errors), badLevel.errors?.[0] ?? badLevel.error ?? '');
  const noLevel = await emitAck(ann, 'ai:play', undefined);
  check('ai:play without a payload is refused cleanly',
    noLevel.ok === false && !String(noLevel.error ?? '').startsWith('no ack'), JSON.stringify(noLevel));

  // The client follows only a room it adopted, so the ack must come before the
  // room's first state:sync (and before anything the bot says).
  const playOrder = [];
  const noteSync = () => playOrder.push('sync');
  ann.on('state:sync', noteSync);
  const played = await new Promise((resolve) =>
    ann.timeout(5000).emit('ai:play', { level: 'medium', model: 'ai' }, (err, result) => {
      playOrder.push('ack');
      resolve(err ? { ok: false, error: 'no ack for ai:play' } : result);
    }),
  );
  await sleep(300);
  ann.off('state:sync', noteSync);
  const aiRoomId = played.roomId;

  check('ai:play seats you as a player in a new room',
    played.ok === true && played.seat === 'player' && Boolean(aiRoomId), JSON.stringify(played));
  check('the ai:play ack arrives before the room’s first state:sync',
    playOrder[0] === 'ack' && playOrder.includes('sync'), playOrder.join(' → '));

  const aiState = annView.state;
  const botSeat = aiState?.players.find((p) => p.bot);
  const botId = botSeat?.id;
  check('the room seats you and a bot, and the match starts at once',
    aiState?.roomId === aiRoomId && aiState?.status === 'playing' && aiState.players.length === 2 &&
      botSeat?.bot?.level === 'medium' && botSeat.bot.model === 'ai' && aiState.players.some((p) => p.id === annJoin.playerId && !p.bot),
    aiState ? `${aiState.status}, ${aiState.players.map((p) => `${p.nickname}${p.bot ? `(${p.bot.level}/${p.bot.model})` : ''}`).join(' vs ')}` : 'no state');
  check('an AI room is a casual Classic board with you as host',
    aiState?.origin === 'ai' && aiState.config.mode === 'casual' && aiState.rows === 6 &&
      aiState.cols === 6 && aiState.bombCount === 11 && aiState.hostId === annJoin.playerId,
    JSON.stringify(aiState?.config));
  check('a bot id is never a connection id', typeof botId === 'string' && botId.startsWith('bot:'), String(botId));

  await sleep(300);
  check('the bot is never listed as a connected client',
    Boolean(latestAdmin) && !latestAdmin.clients.some((c) => c.id === botId) &&
      latestAdmin.clientCount === latestAdmin.clients.length,
    `${latestAdmin?.clientCount} clients`);
  check('the bot is not in the players’ online list',
    !(annLobby.latest?.online ?? []).some((p) => p.id === botId || p.nickname === botSeat?.nickname));
  check('the AI room is listed in the lobby, so others can watch',
    (outsiderLobby.latest?.rooms ?? []).some((r) => r.id === aiRoomId));

  // A spectator watches the whole thing, and hears the chat later on.
  const sam = await connect();
  await setName(sam, 'Sam');
  const samWatch = await emitAck(sam, 'room:spectate', { roomId: aiRoomId });
  check('spectators may watch a game against the computer', samWatch.ok === true && samWatch.seat === 'spectator',
    samWatch.errors?.[0] ?? '');

  let botMoves = 0;
  ann.on('cell:revealed', ({ cell }) => {
    if (cell.byPlayerId === botId) botMoves++;
  });

  // Play the match out: Ann moves on her turns (hints first, once), the bot on its own.
  let hintOnTurn = null;
  let hintCovered = false;
  let hintAgain = null;
  const drained = [];
  let hintOffTurn = null;
  const attempted = new Set();
  const deadline = Date.now() + 150_000;
  while (!annView.ended && Date.now() < deadline) {
    const s = annView.state;
    if (!s || s.status !== 'playing') {
      await sleep(50);
      continue;
    }
    if (s.currentPlayerId === botId) {
      if (!hintOffTurn) hintOffTurn = await emitAck(ann, 'ai:hint', {});
      await sleep(50);
      continue;
    }
    if (s.currentPlayerId !== annJoin.playerId) {
      await sleep(50);
      continue;
    }
    if (!hintOnTurn) {
      hintOnTurn = await emitAck(ann, 'ai:hint', {});
      hintCovered = hintOnTurn.ok === true &&
        !s.revealed.some((c) => c.row === hintOnTurn.row && c.col === hintOnTurn.col);
      hintAgain = await emitAck(ann, 'ai:hint', {});
      for (let i = 0; i < 10; i++) {
        const next = await emitAck(ann, 'ai:hint', {});
        drained.push(next);
        if (!next.ok) break;
      }
    }
    const open = new Set(s.revealed.map((c) => `${c.row}:${c.col}`));
    let target = null;
    for (let row = 0; row < s.rows && !target; row++) {
      for (let col = 0; col < s.cols && !target; col++) {
        const key = `${row}:${col}`;
        if (!open.has(key) && !attempted.has(`${s.revealed.length}|${key}`)) target = { row, col, key };
      }
    }
    if (target) {
      attempted.add(`${s.revealed.length}|${target.key}`);
      ann.emit('game:reveal', { row: target.row, col: target.col });
    }
    await sleep(80);
  }

  check('ai:hint on your turn names a covered cell with a reason',
    hintCovered && typeof hintOnTurn?.text === 'string' && hintOnTurn.text.length > 0,
    JSON.stringify(hintOnTurn));
  // The ack carries the deterministic "Why?" worked out from the public board.
  // The language model's reworded ai:hintWhy follows only with a Groq key and
  // in time, so it is deliberately not asserted here.
  const hintLabel = hintOnTurn?.ok === true
    ? `${String.fromCharCode(65 + hintOnTurn.col)}${hintOnTurn.row + 1}`
    : '';
  check('the ai:hint answer carries a "why" that names the hinted cell',
    hintLabel !== '' && typeof hintOnTurn?.why === 'string' && hintOnTurn.why.length > 0 &&
      hintOnTurn.why.includes(hintLabel),
    `${hintLabel}: ${JSON.stringify(hintOnTurn?.why)}`);
  check('hintsLeft counts down with each hint',
    hintAgain?.ok === true && hintOnTurn?.hintsLeft === hintAgain.hintsLeft + 1,
    `${hintOnTurn?.hintsLeft} → ${hintAgain?.hintsLeft}`);
  const lastHint = drained.at(-1);
  check('hints run out, and the refusal still says how many are left',
    lastHint?.ok === false && lastHint.hintsLeft === 0, JSON.stringify(lastHint));
  check('ai:hint is refused on the bot’s turn', hintOffTurn?.ok === false, JSON.stringify(hintOffTurn));
  check('the bot plays its own turns', botMoves >= 1, `${botMoves} bot move(s)`);

  const aiEnded = annView.ended;
  check('a match against the bot runs to the end', Boolean(aiEnded),
    aiEnded ? `${aiEnded.players.map((p) => `${p.nickname} ${p.score}`).join(', ')}` : 'timed out');
  check('scores against the bot add up to the mines', aiEnded?.players.reduce((n, p) => n + p.score, 0) === 11);

  if (aiEnded) {
    for (let i = 0; i < 40 && !annView.state?.rematchVotes?.includes(botId); i++) await sleep(100);
    check('the bot votes for a rematch after a moment', annView.state?.rematchVotes?.includes(botId) === true,
      JSON.stringify(annView.state?.rematchVotes));

    // Ann votes too: a new match, and a fresh set of hints.
    const again = waitFor(ann, 'match:start', 6000).catch(() => null);
    ann.emit('game:rematch');
    check('your vote and the bot’s start the rematch', Boolean(await again));
    for (let i = 0; i < 150 && annView.state?.currentPlayerId !== annJoin.playerId; i++) await sleep(100);
    const freshHint = await emitAck(ann, 'ai:hint', {});
    check('hints reset when a new match starts',
      freshHint.ok === true && freshHint.hintsLeft === hintOnTurn?.hintsLeft, JSON.stringify(freshHint));
  }

  // Room chat: everyone in the room hears it, sender included; nobody else does.
  const samHeard = [];
  const annHeard = [];
  sam.on('room:message', (m) => samHeard.push(m));
  ann.on('room:message', (m) => annHeard.push(m));

  const said = await emitAck(ann, 'room:say', { text: '  hello from Ann  ' });
  await sleep(250);
  const heard = samHeard.find((m) => m.fromId === annJoin.playerId);
  check('room:say reaches the other members of the room',
    said.ok === true && heard?.text === 'hello from Ann' && heard.fromName === 'Ann' &&
      heard.kind === 'player' && heard.roomId === aiRoomId && typeof heard.id === 'string' && typeof heard.at === 'number',
    JSON.stringify(heard ?? said));
  check('the sender gets their own line back', annHeard.some((m) => m.text === 'hello from Ann'));
  check('chat never leaves the room', overheard.length === 0, `${overheard.length} overheard`);

  const samSaid = await emitAck(sam, 'room:say', { text: 'go bot' });
  check('spectators can chat too', samSaid.ok === true, samSaid.error ?? '');

  const empty = await emitAck(ann, 'room:say', { text: '   ' });
  check('an empty chat line is refused', empty.ok === false, empty.error ?? '');
  const nowhere = await emitAck(outsider, 'room:say', { text: 'anyone?' });
  check('chat needs a room', nowhere.ok === false, nowhere.error ?? '');

  const burst = [];
  for (let i = 0; i < 5; i++) burst.push(await emitAck(ann, 'room:say', { text: `line ${i + 2}` }));
  check('a burst of five lines inside ten seconds goes through… (hello + four)',
    burst.slice(0, 4).every((r) => r.ok === true), burst.map((r) => r.ok).join(','));
  check('…and the sixth is refused', burst[4]?.ok === false, burst[4]?.error ?? '');

  // A normal room gets no hints, whoever asks.
  const p1 = await connect();
  const p2 = await connect();
  await setName(p1, 'Uma');
  await setName(p2, 'Vic');
  const p1View = track(p1);
  const normal = await emitAck(p1, 'room:create', { name: 'No hints', config: CLASSIC });
  await emitAck(p2, 'room:join', { roomId: normal.roomId });
  p1.emit('game:start');
  await sleep(400);
  const onTurnHere = p1View.state?.currentPlayerId === p1.id ? p1 : p2;
  const noHint = await emitAck(onTurnHere, 'ai:hint', {});
  check('ai:hint is refused in a normal room', noHint.ok === false && noHint.hintsLeft === undefined,
    JSON.stringify(noHint));
  p1.close();
  p2.close();

  // The last person out closes the room — the bot does not keep it alive.
  sam.emit('room:leave');
  await sleep(200);
  check('the room stays open while a person is still in it',
    (outsiderLobby.latest?.rooms ?? []).some((r) => r.id === aiRoomId));
  ann.emit('room:leave');
  await sleep(500);
  check('leaving a game against the computer closes the room',
    !(outsiderLobby.latest?.rooms ?? []).some((r) => r.id === aiRoomId) &&
      !latestAdmin?.rooms.some((r) => r.id === aiRoomId));

  for (const socket of [ann, sam, outsider]) socket.close();
}

// ── the Fruit Fly bot ───────────────────────────────────────────────────────
section('fruit fly bot');

// The experimental level: a connectome circuit picks the bot's moves. A
// missing or broken circuit file would fall back to the solver without a
// visible change, so the server's error log is checked too.
{
  const fay = await connect();
  const fayJoin = await setName(fay, 'Fay');
  const fayView = track(fay);
  const errorsBefore = adminLog.filter((l) => l.kind === 'error').length;

  // Every thought and every reveal of this match, in the order they reach Fay,
  // collected from before the game starts so no move can slip past unrecorded.
  let flyEvents = 0;
  const flyThoughts = [];
  const flyReveals = [];
  fay.on('ai:flyThought', (payload) => {
    const open = fayView.state?.revealed ?? [];
    flyThoughts.push({
      payload,
      order: flyEvents++,
      at: Date.now(),
      revealedAtArrival: open.length,
      open: new Set(open.map(({ row, col }) => `${row}:${col}`)),
    });
  });
  fay.on('cell:revealed', ({ cell, state }) => {
    // Fay is the only person in the room, so anyone else's reveal is the fly's.
    if (cell.byPlayerId === fayJoin.playerId) return;
    flyReveals.push({ cell, move: state.revealed.length - 1, order: flyEvents++, at: Date.now() });
  });

  const played = await emitAck(fay, 'ai:play', { level: 'hard', model: 'fly' });
  await sleep(300);
  const flyState = fayView.state;
  const flySeat = flyState?.players.find((p) => p.bot);
  check('ai:play {level: "hard", model: "fly"} seats you against the Fruit Fly',
    played.ok === true && played.seat === 'player' && flyState?.status === 'playing' &&
      JSON.stringify(flySeat?.bot) === JSON.stringify({ level: 'hard', model: 'fly' }) &&
      flySeat.nickname === 'Fruit Fly · Hard' && flyState.roomName.endsWith('vs Fruit Fly · Hard'),
    flyState ? `${flyState.roomName}: ${flyState.players.map((p) => `${p.nickname}${p.bot ? `(${JSON.stringify(p.bot)})` : ''}`).join(' vs ')}` : JSON.stringify(played));

  // A spectator gets the same thoughts as the player.
  const flyWatcher = await connect();
  await setName(flyWatcher, 'Fly watcher');
  const watched = await emitAck(flyWatcher, 'room:spectate', { roomId: played.roomId });
  const watcherJoinedAt = Date.now();
  const watcherThoughts = [];
  flyWatcher.on('ai:flyThought', (payload) => watcherThoughts.push({ payload, at: Date.now() }));
  check('a spectator can watch the Fruit Fly match', watched.ok === true && watched.seat === 'spectator',
    watched.errors?.[0] ?? '');

  // Fay plays the whole match, so the fly gets many turns, each one a full
  // thought → hold → reveal. Fay takes the first covered cell she has not tried.
  const attempted = new Set();
  const deadline = Date.now() + 240_000;
  while (!fayView.ended && Date.now() < deadline) {
    const s = fayView.state;
    if (s?.status === 'playing' && s.currentPlayerId === fayJoin.playerId) {
      const open = new Set(s.revealed.map((c) => `${c.row}:${c.col}`));
      let target = null;
      for (let i = 0; i < s.rows * s.cols && !target; i++) {
        const row = Math.floor(i / s.cols);
        const col = i % s.cols;
        const key = `${s.revealed.length}|${row}:${col}`;
        if (!open.has(`${row}:${col}`) && !attempted.has(key)) target = { row, col, key };
      }
      if (target) {
        attempted.add(target.key);
        fay.emit('game:reveal', { row: target.row, col: target.col });
      }
    }
    await sleep(80);
  }
  check('the Fruit Fly makes moves of its own', flyReveals.length >= 1, `${flyReveals.length} fly move(s)`);

  // The thought for a move is the one whose `move` is how many cells were open
  // when the fly chose it — the same number as that move's place in the reveals.
  const thoughtFor = (reveal) => flyThoughts.find(({ payload }) => payload.move === reveal.move);
  check('every fly move is announced by an ai:flyThought, before its cell is revealed',
    flyReveals.length >= 1 && flyThoughts.length === flyReveals.length &&
      flyReveals.every((reveal) => (thoughtFor(reveal)?.order ?? Infinity) < reveal.order),
    `${flyThoughts.length} thought(s) for ${flyReveals.length} move(s)`);
  check('each thought is about the board it was made on, and the fly then opens the cell it picked',
    flyThoughts.every(({ payload, revealedAtArrival }) => revealedAtArrival === payload.move) &&
      flyReveals.every((reveal) => {
        const pick = thoughtFor(reveal)?.payload.pick;
        return pick?.row === reveal.cell.row && pick?.col === reveal.cell.col;
      }),
    flyReveals.map((r) => `${r.cell.row}:${r.cell.col}`).join(' '));

  const THOUGHT_KEYS = ['botId', 'candidates', 'move', 'neurons', 'pick', 'rates', 'roomId', 'steps'];
  const shapeOk = ({ payload }) =>
    JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(THOUGHT_KEYS) &&
    payload.roomId === played.roomId && payload.botId === flySeat?.id &&
    payload.steps === 16 && payload.neurons === 244 &&
    typeof payload.rates === 'string' &&
    Buffer.from(payload.rates, 'base64').toString('base64') === payload.rates &&
    Buffer.from(payload.rates, 'base64').length === 16 * 244;
  const firstThought = flyThoughts[0]?.payload;
  check('ai:flyThought is 16 steps × 244 neurons: one base64 byte per rate, 3,904 bytes, and nothing else but the move',
    flyThoughts.length >= 1 && flyThoughts.every(shapeOk),
    firstThought ? `${Buffer.byteLength(JSON.stringify(firstThought))} bytes of JSON for the first thought` : 'no thought');

  // The Classic board has 36 cells, under the display cap of 40, so the thought
  // lists every covered cell at the time — and only covered cells: public-board data.
  const candidatesOk = ({ payload, open }) => {
    const seen = new Set();
    for (const { row, col, score } of payload.candidates) {
      const key = `${row}:${col}`;
      const inside = Number.isInteger(row) && row >= 0 && row < flyState.rows &&
        Number.isInteger(col) && col >= 0 && col < flyState.cols;
      if (!inside || !Number.isFinite(score) || open.has(key) || seen.has(key)) return false;
      seen.add(key);
    }
    return seen.size === flyState.rows * flyState.cols - open.size && seen.size <= 40 &&
      seen.has(`${payload.pick.row}:${payload.pick.col}`);
  };
  check('every candidate is a distinct covered cell with a finite score, all covered cells are listed, and the pick is one of them',
    flyThoughts.length >= 1 && flyThoughts.every(candidatesOk),
    `${flyThoughts.map(({ payload }) => payload.candidates.length).join(' ')} candidates per thought`);

  // The thought is held on screen before the reveal (1.2 s on the server, when
  // the turn has the time), so the panel has a moment to play. Measured at Fay,
  // from the thought arriving to the cell arriving.
  const holds = flyReveals.map((reveal) => reveal.at - (thoughtFor(reveal)?.at ?? reveal.at));
  check('the fly holds its thought on screen for about a second before it reveals',
    holds.length >= 1 && Math.max(...holds) >= 1_000,
    `${holds.join(' ')} ms`);

  const sameThought = (a, b) => a.move === b.move && a.rates === b.rates &&
    a.pick.row === b.pick.row && a.pick.col === b.pick.col;
  const heardLater = flyThoughts.filter(({ at }) => at > watcherJoinedAt + 300);
  check('the spectator receives the same Fruit Fly thoughts as the player',
    watcherThoughts.length >= 1 &&
      watcherThoughts.every(({ payload }) => flyThoughts.some((seen) => sameThought(seen.payload, payload))) &&
      heardLater.every(({ payload }) => watcherThoughts.some((heard) => sameThought(heard.payload, payload))),
    `${watcherThoughts.length} spectator thought(s), ${heardLater.length} sent after it joined`);
  check('the Fruit Fly match finishes normally', Boolean(fayView.ended),
    fayView.ended ? `${fayView.ended.players.map((p) => `${p.nickname} ${p.score}`).join(', ')}` : 'timed out');
  check('Fruit Fly match scores add up to the mines',
    fayView.ended?.players.reduce((sum, player) => sum + player.score, 0) === flyState?.bombCount,
    JSON.stringify(fayView.ended?.players.map((p) => p.score)));

  const flyErrors = adminLog.filter((l) => l.kind === 'error').slice(errorsBefore);
  check('…through its circuit, with no bot errors logged',
    !flyErrors.some((l) => /computer move failed/.test(l.text)), flyErrors.map((l) => l.text).join(' | '));

  flyWatcher.emit('room:leave');
  fay.emit('room:leave');
  await sleep(250);
  flyWatcher.close();
  fay.close();
}

// ── picking the opponent ────────────────────────────────────────────────────
section('ai setup');

// The picker's choices: which opponent, which board, and what the AI is made of.
{
  const gus = await connect();
  const gusJoin = await setName(gus, 'Gus');
  const gusView = track(gus);
  const errorsBefore = adminLog.filter((l) => l.kind === 'error').length;

  // JEV is playable only on a server with a TypeSafe key, so what is checked
  // depends on what the server says it has.
  const jevAbout = await emitAck(gus, 'ai:about', {});
  const jevOn = jevAbout?.jev !== null && jevAbout?.jev !== undefined;
  check('ai:about says whether JEV is set up: null, or {provider, model} strings',
    jevAbout !== null && typeof jevAbout === 'object' && 'jev' in jevAbout &&
      (jevAbout.jev === null || (typeof jevAbout.jev.provider === 'string' && typeof jevAbout.jev.model === 'string' &&
        Object.keys(jevAbout.jev).length === 2)) &&
      !(process.env.JEV_API_KEY && JSON.stringify(jevAbout).includes(process.env.JEV_API_KEY)),
    JSON.stringify(jevAbout));
  if (!jevOn) {
    const jev = await emitAck(gus, 'ai:play', { level: 'easy', model: 'jev' });
    check('ai:play refuses JEV when the server has no JEV key',
      jev.ok === false && /isn't set up/i.test(jev.errors?.[0] ?? ''), JSON.stringify(jev));
  } else {
    const jevPlayed = await emitAck(gus, 'ai:play', { level: 'hard', model: 'jev' });
    await sleep(300);
    const jevState = gusView.state;
    const jevSeat = jevState?.players.find((p) => p.bot);
    check('ai:play {level: "hard", model: "jev"} seats you against JEV · Hard',
      jevPlayed.ok === true && jevState?.status === 'playing' &&
        JSON.stringify(jevSeat?.bot) === JSON.stringify({ level: 'hard', model: 'jev' }) &&
        jevSeat.nickname === 'JEV · Hard',
      jevState ? jevState.players.map((p) => p.nickname).join(' vs ') : JSON.stringify(jevPlayed));

    let jevMoves = 0;
    gus.on('cell:revealed', ({ cell }) => {
      if (cell.byPlayerId === jevSeat?.id) jevMoves++;
    });
    const jevTried = new Set();
    const jevUntil = Date.now() + 40_000;
    while (jevMoves < 1 && !gusView.ended && Date.now() < jevUntil) {
      const s = gusView.state;
      if (s?.status === 'playing' && s.currentPlayerId === gusJoin.playerId) {
        const open = new Set(s.revealed.map((c) => `${c.row}:${c.col}`));
        let target = null;
        for (let i = 0; i < s.rows * s.cols && !target; i++) {
          const row = Math.floor(i / s.cols);
          const col = i % s.cols;
          const key = `${s.revealed.length}|${row}:${col}`;
          if (!open.has(`${row}:${col}`) && !jevTried.has(key)) target = { row, col, key };
        }
        if (target) {
          jevTried.add(target.key);
          gus.emit('game:reveal', { row: target.row, col: target.col });
        }
      }
      await sleep(80);
    }
    check('JEV makes a move, with no bot errors logged',
      jevMoves >= 1 && !adminLog.filter((l) => l.kind === 'error').slice(errorsBefore).some((l) => /computer move failed/.test(l.text)),
      `${jevMoves} move(s)`);
  }
  const oddSize = await emitAck(gus, 'ai:play', { level: 'easy', model: 'ai', size: 7 });
  check('ai:play refuses a board size that is not offered',
    oddSize.ok === false && Array.isArray(oddSize.errors), JSON.stringify(oddSize));
  const oddDensity = await emitAck(gus, 'ai:play', { level: 'easy', model: 'ai', density: 'extreme' });
  check('ai:play refuses a mine density that is not offered',
    oddDensity.ok === false && Array.isArray(oddDensity.errors), JSON.stringify(oddDensity));

  const big = await emitAck(gus, 'ai:play', { level: 'easy', model: 'ai', size: 10, density: 'heavy' });
  await sleep(300);
  const bigState = gusView.state;
  check('ai:play builds the board you picked: 10×10 with heavy mines',
    big.ok === true && bigState?.rows === 10 && bigState.cols === 10 && bigState.bombCount === 40,
    bigState ? `${bigState.rows}x${bigState.cols}, ${bigState.bombCount} mines` : JSON.stringify(big));

  const easyFly = await emitAck(gus, 'ai:play', { level: 'easy', model: 'fly' });
  await sleep(300);
  const easyState = gusView.state;
  const easySeat = easyState?.players.find((p) => p.bot);
  check('ai:play {level: "easy", model: "fly"} seats you against Fruit Fly · Easy',
    easyFly.ok === true && easySeat?.nickname === 'Fruit Fly · Easy' &&
      JSON.stringify(easySeat.bot) === JSON.stringify({ level: 'easy', model: 'fly' }),
    easyState ? easyState.players.map((p) => p.nickname).join(' vs ') : JSON.stringify(easyFly));

  let easyMoves = 0;
  gus.on('cell:revealed', ({ cell }) => {
    if (cell.byPlayerId === easySeat?.id) easyMoves++;
  });
  const tried = new Set();
  const until = Date.now() + 40_000;
  while (easyMoves < 1 && !gusView.ended && Date.now() < until) {
    const s = gusView.state;
    if (s?.status === 'playing' && s.currentPlayerId === gusJoin.playerId) {
      const open = new Set(s.revealed.map((c) => `${c.row}:${c.col}`));
      let target = null;
      for (let i = 0; i < s.rows * s.cols && !target; i++) {
        const row = Math.floor(i / s.cols);
        const col = i % s.cols;
        const key = `${s.revealed.length}|${row}:${col}`;
        if (!open.has(`${row}:${col}`) && !tried.has(key)) target = { row, col, key };
      }
      if (target) {
        tried.add(target.key);
        gus.emit('game:reveal', { row: target.row, col: target.col });
      }
    }
    await sleep(80);
  }
  check('the Fruit Fly on Easy makes a move, with no bot errors logged',
    easyMoves >= 1 && !adminLog.filter((l) => l.kind === 'error').slice(errorsBefore).some((l) => /computer move failed/.test(l.text)),
    `${easyMoves} move(s)`);

  const about = await emitAck(gus, 'ai:about', {});
  check('ai:about says whether a language model is behind the AI, never the key',
    about !== null && typeof about === 'object' &&
      (about.llm === null || (typeof about.llm.provider === 'string' && typeof about.llm.model === 'string')) &&
      !JSON.stringify(about).includes('gsk_') && 'jev' in about,
    JSON.stringify(about));

  gus.emit('room:leave');
  await sleep(200);
  gus.close();
}

// ── private rooms and joining by code ───────────────────────────────────────
section('private rooms');

// A private room is left out of the players' game list and its code out of
// the online list; the console still lists it, and the code gets anyone in.
{
  const priya = await connect();
  const priyaJoin = await setName(priya, 'Priya');
  const priyaView = track(priya);
  const quinn = await connect();
  const quinnJoin = await setName(quinn, 'Quinn');
  const quinnLobby = trackLobby(quinn);
  const remy = await connect();
  const remyJoin = await setName(remy, 'Remy');

  const SECRET = { rows: 5, cols: 5, mineCount: 4, maxPlayers: 3, mode: 'casual', private: true };
  const made = await emitAck(priya, 'room:create', { name: 'Secret', config: SECRET });
  const code = made.roomId;
  await sleep(250);
  check('a Custom room can be made private',
    made.ok === true && priyaView.state?.roomId === code && priyaView.state.config.private === true,
    JSON.stringify(priyaView.state?.config ?? made));
  check('a private room is left out of other players’ game list',
    Boolean(quinnLobby.latest) && !quinnLobby.latest.rooms.some((r) => r.id === code),
    (quinnLobby.latest?.rooms ?? []).map((r) => r.id).join(', '));
  check('the server console still lists the private room',
    latestAdmin?.rooms.some((r) => r.id === code && r.config.private === true) === true);
  check('the console still sees which room its members are in',
    latestAdmin?.clients.some((c) => c.id === priyaJoin.playerId && c.roomId === code) === true);

  const priyaRow = (quinnLobby.latest?.online ?? []).find((p) => p.id === priyaJoin.playerId);
  check('the online list says “in a private room” without the code',
    priyaRow?.privateRoom === true && priyaRow.roomId === null && priyaRow.status === 'room',
    JSON.stringify(priyaRow));

  // Looking a room up by its code: what a share link or typed code needs to
  // choose between joining and asking the host.
  const looked = await emitAck(quinn, 'room:lookup', { roomId: code.toLowerCase() });
  check('room:lookup finds a private room by its code, in any case',
    looked.ok === true && looked.room?.id === code && looked.room.config.private === true,
    JSON.stringify(looked));
  const unknown = await emitAck(quinn, 'room:lookup', { roomId: 'ZZZZ' });
  check('room:lookup says when a code leads nowhere',
    unknown.ok === false && /no longer exists/i.test(unknown.error ?? ''), JSON.stringify(unknown));
  const lookupGarbage = await emitAck(quinn, 'room:lookup', { roomId: { $gt: '' } });
  check('room:lookup with a garbage code is refused cleanly',
    lookupGarbage.ok === false && !String(lookupGarbage.error ?? '').startsWith('no ack'),
    JSON.stringify(lookupGarbage));

  const joined = await emitAck(quinn, 'room:join', { roomId: code.toLowerCase() });
  check('joining a private room by its code works',
    joined.ok === true && joined.seat === 'player' && joined.roomId === code, JSON.stringify(joined));
  const watching = await emitAck(remy, 'room:spectate', { roomId: code });
  check('watching a private room by its code works',
    watching.ok === true && watching.seat === 'spectator', JSON.stringify(watching));

  await sleep(250);
  const rows = quinnLobby.latest?.online ?? [];
  const members = [priyaJoin, quinnJoin, remyJoin].map((j) => rows.find((p) => p.id === j.playerId));
  check('every member, players and spectators, shows as in a private room',
    members.every((p) => p?.privateRoom === true && p.roomId === null),
    members.map((p) => `${p?.nickname}:${p?.privateRoom}:${p?.roomId}`).join(', '));
  check('a spectator in a private room still shows as watching',
    members[2]?.status === 'watching', members[2]?.status);
  check('no online row anywhere carries the private code', !rows.some((p) => p.roomId === code));
  check('the room stays out of the game list once people are in it',
    !(quinnLobby.latest?.rooms ?? []).some((r) => r.id === code));

  // Private and ask-to-join together: the code finds it, the host still decides.
  const asking = await emitAck(priya, 'room:create', {
    name: 'Secret, ask first',
    config: { ...SECRET, joinByRequest: true },
  });
  for (const socket of [quinn, remy]) socket.emit('room:leave');
  await sleep(250);
  const askLook = await emitAck(quinn, 'room:lookup', { roomId: asking.roomId });
  check('room:lookup shows a private room asks to join, so the client asks',
    askLook.ok === true && askLook.room?.config.joinByRequest === true && askLook.room.config.private === true,
    JSON.stringify(askLook.room?.config ?? askLook));
  const askDirect = await emitAck(quinn, 'room:join', { roomId: asking.roomId });
  check('a private ask-to-join room still refuses a direct join', askDirect.ok === false,
    askDirect.errors?.[0] ?? '');
  const asked = await emitAck(quinn, 'room:requestJoin', { roomId: asking.roomId });
  await sleep(200);
  check('asking to join a private room by its code reaches the host',
    asked.ok === true && priyaView.state?.joinRequests?.some((r) => r.id === quinnJoin.playerId) === true,
    asked.error ?? JSON.stringify(priyaView.state?.joinRequests));
  quinn.emit('room:cancelRequest');

  // Classic keeps the original rules: always listed, whatever the client asked.
  const classicPrivate = await emitAck(priya, 'room:create', {
    name: 'Classic, asked private',
    config: { ...CLASSIC, private: true },
  });
  await sleep(250);
  check('a Classic room is never private — it comes back listed',
    classicPrivate.ok === true && priyaView.state?.config.private !== true &&
      (quinnLobby.latest?.rooms ?? []).some((r) => r.id === classicPrivate.roomId),
    JSON.stringify(priyaView.state?.config));

  // Only a literal true hides a room; anything else is a listed room, not a crash.
  const garbage = [];
  for (const value of ['yes', 1, {}, null, [true]]) {
    const r = await emitAck(priya, 'room:create', {
      name: 'Garbage private',
      config: { ...SECRET, private: value },
    });
    await sleep(150);
    garbage.push({
      value: JSON.stringify(value),
      ok: r.ok === true && (quinnLobby.latest?.rooms ?? []).some((room) => room.id === r.roomId),
    });
  }
  check('a garbage private value makes a listed room, never an error',
    garbage.every((g) => g.ok), garbage.map((g) => `${g.value}:${g.ok}`).join(', '));

  // Games against the computer are Classic-shaped and never private.
  const vsBot = await emitAck(priya, 'ai:play', { level: 'easy', model: 'ai' });
  await sleep(250);
  check('a game against the computer is never private',
    vsBot.ok === true && (quinnLobby.latest?.rooms ?? []).some((r) => r.id === vsBot.roomId),
    JSON.stringify(vsBot));

  for (const socket of [priya, quinn, remy]) socket.close();
  await sleep(200);
}

// ── world chat and invite cards ─────────────────────────────────────────────
section('world chat');

// The lobby's chat: any named client, kept in server memory for newcomers,
// rate-limited per connection. Invite cards advertise a room with a Join
// button; the admin console can empty it for everyone.
{
  /** The next `event` on `socket` that `match` accepts, or null on timeout. */
  const waitForWhere = (socket, event, match, timeoutMs = 3000) =>
    new Promise((resolve) => {
      const onEvent = (payload) => {
        if (!match(payload)) return;
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(payload);
      };
      const timer = setTimeout(() => {
        socket.off(event, onEvent);
        resolve(null);
      }, timeoutMs);
      socket.on(event, onEvent);
    });

  const wes = await connect();
  const wesJoin = await setName(wes, 'Wes');
  const xia = await connect();
  const xiaJoin = await setName(xia, 'Xia');

  const xiaHeard = waitForWhere(xia, 'lobby:message', (m) => m?.fromId === wesJoin.playerId);
  const said = await emitAck(wes, 'lobby:say', { text: '  hello \n  world  ' });
  const heard = await xiaHeard;
  check('a world-chat line reaches another client, cleaned',
    said.ok === true && heard?.text === 'hello world' && heard.fromName === 'Wes' &&
      heard.kind === 'player' && heard.isGuest === true && typeof heard.id === 'string',
    JSON.stringify(heard ?? said));

  const nameless = await connect();
  const namelessSay = await emitAck(nameless, 'lobby:say', { text: 'hi' });
  check('a client with no name cannot talk in the world chat',
    namelessSay.ok === false && !String(namelessSay.error ?? '').startsWith('no ack'),
    JSON.stringify(namelessSay));
  const blank = await emitAck(xia, 'lobby:say', { text: ' \n\t ' });
  check('an empty world-chat line is refused', blank.ok === false, JSON.stringify(blank));

  // A newcomer is sent the chat so far, right after picking a name.
  const zed = await connect();
  const zedHistory = waitFor(zed, 'lobby:history', 3000).catch(() => null);
  await setName(zed, 'Zed');
  const history = await zedHistory;
  check('a newcomer gets the world chat so far',
    Array.isArray(history) && history.some((m) => m.text === 'hello world' && m.fromId === wesJoin.playerId),
    Array.isArray(history) ? `${history.length} line(s)` : 'no lobby:history');

  // Wes has sent one line; four more fit in the window, the sixth does not.
  const burst = [];
  for (let i = 1; i <= 5; i++) burst.push(await emitAck(wes, 'lobby:say', { text: `line ${i}` }));
  check('the sixth world-chat line inside ten seconds is refused',
    burst.slice(0, 4).every((r) => r.ok === true) && burst[4].ok === false && /slow down/i.test(burst[4].error ?? ''),
    burst.map((r) => (r.ok ? 'ok' : r.error)).join(' | '));

  // Invite cards.
  const outside = await emitAck(xia, 'lobby:invite', {});
  check('an invite from outside a room is refused',
    outside.ok === false && /room/i.test(outside.error ?? ''), JSON.stringify(outside));

  const FRIDAY = { rows: 6, cols: 6, mineCount: 8, maxPlayers: 4, mode: 'casual' };
  const friday = await emitAck(xia, 'room:create', { name: 'Friday night', config: FRIDAY });
  const zedCard = waitForWhere(zed, 'lobby:message', (m) => m?.kind === 'invite' && m.fromId === xiaJoin.playerId);
  const posted = await emitAck(xia, 'lobby:invite', {});
  const card = await zedCard;
  check('an invite from a seated player arrives with the right room',
    friday.ok === true && posted.ok === true &&
      card?.text === 'Xia invited everyone to Friday night' &&
      card.invite?.roomId === friday.roomId && card.invite.roomName === 'Friday night' &&
      card.invite.rows === 6 && card.invite.cols === 6 && card.invite.mineCount === 8 &&
      card.invite.playerCount === 1 && card.invite.maxPlayers === 4 &&
      card.invite.mode === 'casual' && card.invite.joinByRequest === false && card.invite.private === undefined,
    JSON.stringify(card ?? posted));

  const again = await emitAck(xia, 'lobby:invite', {});
  check('a second invite inside 30 seconds is refused',
    again.ok === false && /try again/i.test(again.error ?? ''), JSON.stringify(again));

  const watching = await emitAck(zed, 'room:spectate', { roomId: friday.roomId });
  const fromSpectator = await emitAck(zed, 'lobby:invite', {});
  check('a spectator cannot post an invite',
    watching.ok === true && fromSpectator.ok === false && /players/i.test(fromSpectator.error ?? ''),
    JSON.stringify(fromSpectator));
  zed.emit('room:leave');
  await sleep(150);

  // A private room's code goes public only on its host's say-so.
  const HIDEOUT = { rows: 5, cols: 5, mineCount: 4, maxPlayers: 3, mode: 'casual', private: true };
  const hideout = await emitAck(wes, 'room:create', { name: 'Hideout', config: HIDEOUT });
  const zedIn = await emitAck(zed, 'room:join', { roomId: hideout.roomId });
  const nonHost = await emitAck(zed, 'lobby:invite', {});
  check("a private room's non-host cannot post its invite",
    hideout.ok === true && zedIn.ok === true && nonHost.ok === false && /host/i.test(nonHost.error ?? ''),
    JSON.stringify(nonHost));
  const xiaSecret = waitForWhere(xia, 'lobby:message', (m) => m?.kind === 'invite' && m.fromId === wesJoin.playerId);
  const hostPosts = await emitAck(wes, 'lobby:invite', {});
  const secretCard = await xiaSecret;
  check("a private room's host may post it, and the card says it is private",
    hostPosts.ok === true && secretCard?.invite?.roomId === hideout.roomId && secretCard.invite.private === true,
    JSON.stringify(secretCard ?? hostPosts));

  // A full room has nothing to offer anyone reading the card.
  const yan = await connect();
  await setName(yan, 'Yan');
  const pair = await emitAck(yan, 'room:create', { name: 'Pair', config: CLASSIC });
  const xiaIn = await emitAck(xia, 'room:join', { roomId: pair.roomId });
  const whenFull = await emitAck(yan, 'lobby:invite', {});
  check('a full room cannot be advertised',
    pair.ok === true && xiaIn.ok === true && whenFull.ok === false && /full/i.test(whenFull.error ?? ''),
    JSON.stringify(whenFull));

  // The console empties it for everyone, and says so in its log.
  const wesCleared = waitFor(wes, 'lobby:cleared', 3000).then(() => true, () => false);
  const zedCleared = waitFor(zed, 'lobby:cleared', 3000).then(() => true, () => false);
  admin.emit('admin:clearChat');
  const cleared = await Promise.all([wesCleared, zedCleared]);
  const late = await connect();
  const lateHistory = waitFor(late, 'lobby:history', 3000).catch(() => null);
  await setName(late, 'Late');
  const afterClear = await lateHistory;
  // Only this section's own lines are checked: on a shared server someone else
  // may say something between the clear and the newcomer's arrival.
  const ours = new Set([wesJoin.playerId, xiaJoin.playerId]);
  check('admin clearChat empties the world chat for everyone',
    cleared.every(Boolean) && Array.isArray(afterClear) && !afterClear.some((m) => ours.has(m?.fromId)),
    `cleared: ${cleared.join(', ')}; newcomer sees ${Array.isArray(afterClear) ? afterClear.length : 'nothing'}`);
  await sleep(100);
  check('clearing the world chat is logged under moderation',
    adminLog.some((l) => l.kind === 'moderation' && /world chat/i.test(l.text)));

  for (const socket of [wes, xia, zed, yan, nameless, late]) socket.close();
  await sleep(200);
}

// ── player reports ──────────────────────────────────────────────────────────
section('player reports');

// Anyone named may report anyone else online; guests too. The server fills in
// who and where from its own records, rate-limits, and tells every console.
{
  const GID_A = 'a'.repeat(32);
  const GID_B = 'b'.repeat(32);
  const rena = await connect();
  const renaJoin = await emitAck(rena, 'player:join', { nickname: 'Rena', guestId: GID_A });
  const sol = await connect();
  const solJoin = await emitAck(sol, 'player:join', { nickname: 'Sol', guestId: GID_B });
  const nobody = await connect();

  const arrives = waitFor(admin, 'admin:reports', 3000).catch(() => null);
  const sent = await emitAck(rena, 'player:report', {
    targetId: solJoin.playerId,
    reason: 'harassment',
    details: '  kept \n  spamming  ',
  });
  const list = await arrives;
  const mine = Array.isArray(list) ? list.find((r) => r.reporter?.nickname === 'Rena' && r.target?.nickname === 'Sol') : null;
  check('a guest can report another player, and the console gets it at once',
    sent.ok === true && mine?.reason === 'harassment' && mine.details === 'kept spamming' && mine.status === 'open',
    JSON.stringify(mine ?? sent));
  check('the report carries what the server knows: guest ids, address, the live connection',
    mine?.reporter.guestId === GID_A && mine?.target.guestId === GID_B &&
      mine?.target.clientId === solJoin.playerId && typeof mine?.reporter.address === 'string' &&
      mine.reporter.isGuest === true && mine.reporter.profileId === null,
    JSON.stringify(mine?.reporter));
  await sleep(100);
  check('a report is logged under moderation',
    adminLog.some((l) => l.kind === 'moderation' && /Rena reported Sol/.test(l.text)));

  const again = await emitAck(rena, 'player:report', { targetId: solJoin.playerId, reason: 'spam' });
  check('reporting the same player again inside ten minutes is refused',
    again.ok === false && /already reported/i.test(again.error ?? ''), JSON.stringify(again));
  const self = await emitAck(rena, 'player:report', { targetId: renaJoin.playerId, reason: 'cheating' });
  check('you cannot report yourself', self.ok === false && /yourself/i.test(self.error ?? ''), JSON.stringify(self));
  const gone = await emitAck(rena, 'player:report', { targetId: 'no-such-socket', reason: 'cheating' });
  check('a player who is not online cannot be reported',
    gone.ok === false && /no longer online/i.test(gone.error ?? ''), JSON.stringify(gone));
  const badReason = await emitAck(sol, 'player:report', { targetId: renaJoin.playerId, reason: 'afk' });
  const vague = await emitAck(sol, 'player:report', { targetId: renaJoin.playerId, reason: 'other' });
  const long = await emitAck(sol, 'player:report', { targetId: renaJoin.playerId, reason: 'spam', details: 'x'.repeat(301) });
  check('a report needs a known reason, words for "something else", and short details',
    badReason.ok === false && vague.ok === false && long.ok === false,
    [badReason, vague, long].map((r) => r.error).join(' | '));
  const anon = await emitAck(nobody, 'player:report', { targetId: solJoin.playerId, reason: 'spam' });
  check('a client with no name cannot report',
    anon.ok === false && !String(anon.error ?? '').startsWith('no ack'), JSON.stringify(anon));

  const resolvedArrives = waitFor(admin, 'admin:reports', 3000).catch(() => null);
  const resolved = await emitAck(admin, 'admin:report', { id: mine?.id, status: 'resolved' });
  const after = await resolvedArrives;
  const handled = Array.isArray(after) ? after.find((r) => r.id === mine?.id) : null;
  check('the console resolves a report, and every console hears',
    resolved.ok === true && handled?.status === 'resolved' && typeof handled.handledAt === 'number',
    JSON.stringify(handled ?? resolved));
  const badStatus = await emitAck(admin, 'admin:report', { id: mine?.id, status: 'deleted' });
  const missing = await emitAck(admin, 'admin:report', { id: 'nope', status: 'dismissed' });
  check('the console refuses an unknown status or report',
    badStatus.ok === false && missing.ok === false, `${badStatus.error} | ${missing.error}`);

  // An id that does not look like the browser's is dropped, not stored.
  const odd = await connect();
  const oddJoin = await emitAck(odd, 'player:join', { nickname: 'Odd', guestId: '<script>' });
  const oddArrives = waitFor(admin, 'admin:reports', 3000).catch(() => null);
  await emitAck(odd, 'player:report', { targetId: solJoin.playerId, reason: 'spam' });
  const oddList = await oddArrives;
  const oddRow = Array.isArray(oddList) ? oddList.find((r) => r.reporter?.nickname === 'Odd') : null;
  check('a malformed guest id is not kept',
    oddJoin.welcome === 'Welcome, Odd.' && oddRow?.reporter.guestId === null, JSON.stringify(oddRow?.reporter));
  // Leave nothing of ours open on a shared server's console.
  if (oddRow) await emitAck(admin, 'admin:report', { id: oddRow.id, status: 'dismissed' });

  for (const socket of [rena, sol, nobody, odd]) socket.close();
  await sleep(150);
}

// ── review coach ────────────────────────────────────────────────────────────
section('review coach');

// The server may or may not have a Groq key: this checks the protocol either
// way, and never anything about what the model says.
{
  const first = aliceView.replays[0]?.payload;
  const replayId = first?.replayId;
  const askLong = (socket, payload) =>
    new Promise((resolve) =>
      socket.timeout(25000).emit('review:ask', payload, (err, result) =>
        resolve(err ? { ok: false, error: 'no ack for review:ask' } : result),
      ),
    );
  const clean = (res) => res?.ok === false && typeof res.error === 'string' && !res.error.startsWith('no ack');

  const asker = await connect();
  await setName(asker, 'Coachee');

  const JUNK = [undefined, null, 42, 'text', [], {}, { replayId: {} }, { replayId: '' }, { replayId: 'x'.repeat(300) },
    { matchId: 'latest' }, { matchId: "x' or 1=1 --" }, { matchId: [] }];
  const coachJunk = [];
  const askJunk = [];
  for (const junk of JUNK) {
    coachJunk.push(await emitAck(asker, 'review:coach', junk));
    askJunk.push(await emitAck(asker, 'review:ask', junk));
  }
  check('review:coach with junk is a clean ok: false', coachJunk.every((r) => clean(r) && r.available === false),
    JSON.stringify(coachJunk.find((r) => !(clean(r) && r.available === false))));
  check('review:ask with junk is a clean ok: false', askJunk.every(clean),
    JSON.stringify(askJunk.find((r) => !clean(r))));

  const unknown = { replayId: 'no-such-replay' };
  check('review:coach for a game the server never held is ok: false', clean(await emitAck(asker, 'review:coach', unknown)));
  check('review:ask for a game the server never held is ok: false',
    clean(await emitAck(asker, 'review:ask', { ...unknown, question: 'Where did the game turn?' })));
  // The server has no database here to load a saved match from, and a client
  // can never hand it a replay to be believed.
  check('a client-sent replay is never believed: no stored game, no answer',
    clean(await emitAck(asker, 'review:ask', {
      ...unknown, replay: aliceView.replays[0]?.payload.replay, question: 'Where did the game turn?',
    })));
  check('a match id the server cannot load is ok: false',
    clean(await emitAck(asker, 'review:ask', { matchId: '6a2b1f2e-0000-4000-8000-000000000001', question: 'Hi?' })));

  check('the server had a replay id to ask about', typeof replayId === 'string' && replayId.length > 0);
  const status = await emitAck(asker, 'review:coach', { replayId });
  check('review:coach for a real game answers cleanly: on with a count, or off with a reason',
    typeof status.available === 'boolean' && status.ok === status.available &&
      (status.available ? Number.isInteger(status.questionsLeft) : clean(status)),
    JSON.stringify(status));
  check('review:coach agrees with what match:replay said about the coach', status.available === first?.coach,
    `coach ${first?.coach}, available ${status.available}`);

  // Questions that are not questions are refused before anything is asked of the model.
  check('an empty question is refused', clean(await emitAck(asker, 'review:ask', { replayId, question: '' })));
  check('a question that is not text is refused', clean(await emitAck(asker, 'review:ask', { replayId, question: { a: 1 } })));
  check('a question over 280 characters is refused', clean(await emitAck(asker, 'review:ask', { replayId, question: 'x'.repeat(281) })));

  // Two questions at once: the second is inside the three-second gap. (The ones
  // above, to games that were never there, spent the gap too: wait it out first,
  // so the first of this pair is really put to the model.)
  await sleep(3200);
  const [one, two] = await Promise.all([
    askLong(asker, { replayId, question: 'Where did the game turn?' }),
    askLong(asker, { replayId, question: 'How do I spot a sure mine?' }),
  ]);
  if (!status.available) {
    check('review:ask without a coach is a clean ok: false', clean(one) && clean(two), JSON.stringify([one, two]));
  } else {
    const fine = (r) =>
      (r.ok === true && typeof r.answer === 'string' && r.answer.length > 0 && r.answer.length <= 600 &&
        Number.isInteger(r.questionsLeft) && r.questionsLeft >= 0 && r.questionsLeft <= 10) ||
      clean(r);
    check('review:ask answers, or says the coach is busy, and nothing else', fine(one),
      `ok=${one.ok} left=${one.questionsLeft} error=${one.error ?? ''}`);
    check('a second question inside the gap is refused', clean(two), `ok=${two.ok} error=${two.error ?? ''}`);
    // An answer counts (9 left); a busy coach costs nothing (still 10), and so does an answer the
    // server threw out. Either way review:coach says what the ack of the question said.
    const after = await emitAck(asker, 'review:coach', { replayId });
    check('the count after a question is what its answer said, and a busy coach costs nothing',
      after.ok === true &&
        (one.ok === true ? after.questionsLeft === one.questionsLeft && one.questionsLeft >= 9 : after.questionsLeft === 10),
      `ok=${one.ok} said ${one.questionsLeft}, now ${after.questionsLeft}`);
  }
  asker.close();
}

// ── malformed messages never take the server down ───────────────────────────
section('malformed messages');

// Anyone on the network can send anything. Each event gets missing, wrong-type
// and hostile payloads, plus a non-function where an acknowledgement goes.
const CLIENT_EVENTS = [
  'player:join', 'room:create', 'room:join', 'room:spectate', 'room:lookup', 'room:leave',
  'room:requestJoin', 'room:cancelRequest', 'room:answerRequest', 'room:kick',
  'friend:invite', 'ai:play', 'ai:about', 'ai:hint', 'room:say', 'lobby:say', 'lobby:invite', 'player:report',
  'review:coach', 'review:ask',
  'queue:join', 'queue:leave', 'game:start', 'game:reveal', 'game:rematch',
];
const ADMIN_EVENTS = ['admin:kick', 'admin:ban', 'admin:closeRoom', 'admin:watch', 'admin:mines', 'admin:clearChat', 'admin:report'];
const BAD_ARGS = [
  [], [undefined], [null], [42], ['text'], [[]], [{}],
  [{ roomId: {}, nickname: {}, name: [], config: 'x', mode: 7, row: 'a', col: null, targetId: [], note: 'x', level: {}, text: [], reason: {}, details: [], guestId: 7, id: {}, status: [], replayId: 7, matchId: {}, question: [] }],
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
