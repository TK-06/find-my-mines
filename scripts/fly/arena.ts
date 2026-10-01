/**
 * Head-to-head simulated matches with the real game rules, to see how the
 * Fruit Fly really plays and to tune its easier levels. Not run by the game.
 *
 *   npx tsx scripts/fly/arena.ts                        the standard suite on 6x6 (Classic, 11 mines)
 *   npx tsx scripts/fly/arena.ts --suite big            fly-Hard vs solver-Medium on 10x10 (31 mines)
 *   npx tsx scripts/fly/arena.ts --pair fly:easy,solver:medium --temp easy=3
 *
 * Rules, as the server plays them: two players alternate; opening a mine
 * scores 1 and keeps the turn (`revealCell`); an empty cell passes it
 * (`nextInTurn`); the match ends when every mine is found; more mines wins,
 * equal is a draw; the first player is drawn at random. Everything is seeded,
 * so a run is reproducible.
 *
 * Players: `fly:easy|medium|hard` (the fly's own neurons, via `flyMove`),
 * `solver:easy|medium|hard` (the AI bots' `planMove`, no language model), and
 * `random` (opens a random covered cell). Results are for the first-named
 * player of each pairing.
 *
 * Options: --matches N (default 300), --seed S (default 20261001),
 * --suite standard|big, --pair A,B (repeatable), --size N (with --pair; default 6),
 * --temp easy=3,medium=1 (override the fly's temperatures for this run),
 * --readout FILE (default the live readout.json), --json FILE (save the rows).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  aiBoard,
  createBoard,
  createRng,
  isAiLevel,
  mineProbabilities,
  nextInTurn,
  planMove,
  randomInt,
  revealCell,
  type AiLevel,
  type CellRef,
  type RevealedCell,
  type Rng,
  type SolverView,
} from '@fmm/shared';
import { FlyBrain, parseReadout } from '../../packages/server/src/ai/fly/brain.js';
import { loadFlyCircuit } from '../../packages/server/src/ai/fly/load.js';
import { FLY_TEMPERATURE, flyMove } from '../../packages/server/src/ai/fly/play.js';

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}
const all = (name: string) =>
  process.argv.flatMap((arg, i) => (arg === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));

const MATCHES = Number(option('matches', '300'));
const SEED = Number(option('seed', '20261001'));
if (!Number.isInteger(MATCHES) || MATCHES < 1 || !Number.isInteger(SEED)) {
  console.error('--matches must be a whole number of at least 1, --seed a whole number');
  process.exit(1);
}

const circuit = loadFlyCircuit();
const readoutFile = resolve(option('readout', 'packages/server/src/ai/fly/readout.json'));
const brain = new FlyBrain(circuit, parseReadout(JSON.parse(readFileSync(readoutFile, 'utf8')), circuit));

for (const pair of option('temp', '').split(',').filter(Boolean)) {
  const [level, value] = pair.split('=');
  if (!isAiLevel(level) || !(Number(value) >= 0)) {
    console.error(`--temp wants easy=3,medium=1 (got "${pair}")`);
    process.exit(1);
  }
  FLY_TEMPERATURE[level] = Number(value);
}

/** Looks at the public board and names a covered cell. */
type Player = (view: SolverView, rng: Rng) => CellRef;

function makePlayer(spec: string): Player {
  const [kind, level] = spec.split(':');
  if (kind === 'random') {
    return (view, rng) => {
      const open = new Set(view.revealed.map((c) => c.row * view.cols + c.col));
      const covered: CellRef[] = [];
      for (let row = 0; row < view.rows; row++) {
        for (let col = 0; col < view.cols; col++) if (!open.has(row * view.cols + col)) covered.push({ row, col });
      }
      return covered[randomInt(rng, covered.length)]!;
    };
  }
  if (!isAiLevel(level)) throw new Error(`Unknown player "${spec}"`);
  if (kind === 'fly') return (view, rng) => flyMove(brain, view, level as AiLevel, rng)!.pick;
  if (kind === 'solver') return (view, rng) => planMove(mineProbabilities(view), level as AiLevel, rng)!.pick;
  throw new Error(`Unknown player "${spec}"`);
}

/** Plays one match; returns each player's mines found (index 0 is the first-named player). */
function playMatch(players: Player[], size: number, seed: number): [number, number] {
  const { rows, cols, mineCount } = aiBoard(size, 'classic');
  const rng = createRng(seed);
  const board = createBoard({ rows, cols, bombCount: mineCount }, rng);
  const rngs = [createRng(seed * 31 + 1), createRng(seed * 31 + 2)];
  const ids = ['0', '1'];
  let turn: string | null = ids[rng() < 0.5 ? 0 : 1]!;
  const scores = [0, 0];
  const revealed: RevealedCell[] = [];
  const view: SolverView = { rows, cols, mineCount, revealed };

  while (revealed.length < rows * cols) {
    const who = Number(turn);
    const cell = players[who]!(view, rngs[who]!);
    const outcome = revealCell(board, cell.row, cell.col);
    if (!outcome.ok) throw new Error(`Player ${who} chose an unplayable cell ${cell.row},${cell.col}`);
    revealed.push({ ...cell, kind: outcome.kind, adjacent: outcome.adjacent, byPlayerId: turn! });
    scores[who]! += outcome.pointsAwarded;
    if (outcome.matchComplete) break;
    if (!outcome.keepsTurn) turn = nextInTurn(ids, turn);
  }
  return [scores[0]!, scores[1]!];
}

interface Row {
  size: number;
  a: string;
  b: string;
  matches: number;
  win: number;
  draw: number;
  loss: number;
  meanMines: number;
  ms: number;
}

function run(a: string, b: string, size: number): Row {
  const players = [makePlayer(a), makePlayer(b)];
  const started = performance.now();
  let win = 0;
  let draw = 0;
  let loss = 0;
  let mines = 0;
  for (let i = 0; i < MATCHES; i++) {
    const [x, y] = playMatch(players, size, SEED + i);
    mines += x;
    if (x > y) win++;
    else if (x < y) loss++;
    else draw++;
  }
  const row = {
    size,
    a,
    b,
    matches: MATCHES,
    win: win / MATCHES,
    draw: draw / MATCHES,
    loss: loss / MATCHES,
    meanMines: mines / MATCHES,
    ms: performance.now() - started,
  };
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
  const { rows, cols, mineCount } = aiBoard(size, 'classic');
  console.log(
    `${`${rows}x${cols}/${mineCount}`.padEnd(8)} ${a.padEnd(13)} vs ${b.padEnd(13)} win${pct(row.win)}  draw${pct(row.draw)}  loss${pct(row.loss)}  ` +
      `(${(row.meanMines).toFixed(1)} of ${mineCount} mines; ${(row.ms / 1000).toFixed(0)} s)`,
  );
  return row;
}

const LEVELS: AiLevel[] = ['easy', 'medium', 'hard'];
const pairs: [string, string, number][] = [];
const given = all('pair');
if (given.length > 0) {
  for (const pair of given) {
    const [a, b] = pair.split(',');
    if (!a || !b) throw new Error(`--pair wants A,B (got "${pair}")`);
    pairs.push([a, b, Number(option('size', '6'))]);
  }
} else if (option('suite', 'standard') === 'big') {
  pairs.push(['fly:hard', 'solver:medium', 10]);
} else {
  for (const level of LEVELS) pairs.push([`fly:${level}`, 'solver:medium', 6]);
  for (const level of LEVELS) if (level !== 'medium') pairs.push(['fly:hard', `solver:${level}`, 6]);
  for (const level of LEVELS) pairs.push([`fly:${level}`, 'random', 6]);
  pairs.push(['solver:hard', 'random', 6], ['solver:medium', 'random', 6]);
}

console.log(`Fly temperatures: ${JSON.stringify(FLY_TEMPERATURE)}; ${MATCHES} matches per pairing, seed ${SEED}`);
const rows = pairs.map(([a, b, size]) => run(a, b, size));
const jsonOut = option('json', '');
if (jsonOut) writeFileSync(resolve(jsonOut), `${JSON.stringify({ temperatures: FLY_TEMPERATURE, rows }, null, 2)}\n`);
