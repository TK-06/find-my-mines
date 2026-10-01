/**
 * Trains the Fruit Fly bot's readout — the small linear layer that turns the
 * circuit's output neurons into "open this cell". Not run by the game.
 *
 *   npx tsx scripts/fly/train.ts --date 2026-10-01
 *
 * Needs no token and no network: it reads circuit.json (from fetch-circuit.mjs).
 *
 * It plays seeded Classic games with the real engine, stops each at a random
 * point, and asks the question the bot asks: here are the covered cells it
 * would look at (`flyCandidatesAll`) — which are mines? Each candidate's public
 * features run through the circuit; a logistic regression on the output
 * neurons learns to predict "this candidate is a mine". The fly's inputs use
 * no solver. The *positions* come from players who open the solver's best cell
 * 60% of the time and a random cell otherwise, so they look like real play;
 * the solver is also run on each position, but only to report it as a
 * reference in the held-out table. Only this script sees the true board, and
 * only as the training label.
 *
 * It prints honest numbers on held-out games: how often the fly's pick is a
 * mine, against the same readout on the raw features with no circuit, a random
 * candidate, and the solver's best cell among the same candidates.
 *
 * Options: --games N (default 10000), --seed S (default 20261001),
 * --date YYYY-MM-DD (required), --out FILE (default the live readout.json).
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aiBoard,
  CLASSIC_PRESET,
  createBoard,
  createRng,
  mineProbabilities,
  planMove,
  randomInt,
  revealCell,
  type CellRef,
  type RevealedCell,
  type Rng,
  type SolverView,
} from '@fmm/shared';
import { FlyBrain, type FlyReadout } from '../../packages/server/src/ai/fly/brain.js';
import { FLY_FEATURES, flyCandidatesAll, flyFeatures } from '../../packages/server/src/ai/fly/features.js';
import { loadFlyCircuit } from '../../packages/server/src/ai/fly/load.js';
import { flyMove } from '../../packages/server/src/ai/fly/play.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

const trainedOn = option('date', '');
if (!/^\d{4}-\d{2}-\d{2}$/.test(trainedOn)) {
  console.error('Pass the training date: --date YYYY-MM-DD');
  process.exit(1);
}
const OUT = resolve(option('out', resolve(HERE, '../../packages/server/src/ai/fly/readout.json')));
const GAMES = Number(option('games', '10000'));
const SEED = Number(option('seed', '20261001'));
if (!Number.isInteger(GAMES) || GAMES < 100 || !Number.isInteger(SEED)) {
  console.error('--games must be a whole number of at least 100, --seed a whole number');
  process.exit(1);
}

/** One move to learn from: each candidate's features and circuit output, whether it is a mine, and the solver's chance (reference only). */
interface Move {
  features: number[][];
  outputs: number[][];
  mines: boolean[];
  solverChance: number[];
}

const circuit = loadFlyCircuit();
const brain = new FlyBrain(circuit);

/**
 * A game stopped after `stopAt` openings. Both "players" open the solver's
 * best cell 60% of the time and a random covered cell otherwise, so the
 * boards look like real play: mines found, numbers showing, turns missed.
 * Returns the public view and the true board (for labels only).
 */
function playUntil(rows: number, cols: number, mineCount: number, stopAt: number, rng: Rng) {
  const board = createBoard({ rows, cols, bombCount: mineCount }, rng);
  const revealed: RevealedCell[] = [];
  let found = 0;
  const view = (): SolverView => ({ rows, cols, mineCount, revealed });
  while (revealed.length < stopAt && found < mineCount - 1) {
    const grid = mineProbabilities(view());
    let cell: CellRef;
    if (rng() < 0.6) cell = planMove(grid, 'hard', rng)!.pick;
    else {
      const covered = grid.flatMap((line, row) => line.flatMap((p, col) => (p === null ? [] : [{ row, col }])));
      cell = covered[randomInt(rng, covered.length)]!;
    }
    const outcome = revealCell(board, cell.row, cell.col);
    if (!outcome.ok) continue;
    if (outcome.kind === 'bomb') found++;
    revealed.push({ ...cell, kind: outcome.kind, adjacent: outcome.adjacent, byPlayerId: 'p' });
  }
  return { board, view: view() };
}

function oneMove(rng: Rng): Move {
  const { rows, cols, mineCount } = CLASSIC_PRESET;
  const { board, view } = playUntil(rows, cols, mineCount, randomInt(rng, 26), rng);
  const grid = mineProbabilities(view);
  const candidates = flyCandidatesAll(view, rng);
  const features = flyFeatures(view, candidates);
  return {
    features,
    outputs: features.map((f) => [...brain.outputs(f)]),
    mines: candidates.map((c) => board.bombs[c.row]![c.col]!),
    solverChance: candidates.map((c) => grid[c.row]![c.col]!),
  };
}

/** Logistic regression by plain gradient descent, on standardised inputs, with a little L2. */
function fitLogistic(rowsX: number[][], labels: boolean[]) {
  const dims = rowsX[0]!.length;
  const mean = Array.from({ length: dims }, (_, d) => rowsX.reduce((s, x) => s + x[d]!, 0) / rowsX.length);
  const std = mean.map((m, d) => {
    const variance = rowsX.reduce((s, x) => s + (x[d]! - m) ** 2, 0) / rowsX.length;
    // A neuron that never varies carries nothing; 1 keeps the maths finite and its weight stays ~0.
    return Math.sqrt(variance) > 1e-9 ? Math.sqrt(variance) : 1;
  });
  const z = rowsX.map((x) => x.map((v, d) => (v - mean[d]!) / std[d]!));
  const y = labels.map((l) => (l ? 1 : 0));
  const weights = new Array<number>(dims).fill(0);
  let bias = 0;
  const RATE = 0.5;
  const L2 = 1e-3;
  for (let epoch = 0; epoch < 1500; epoch++) {
    const grad = new Array<number>(dims).fill(0);
    let gradBias = 0;
    for (let i = 0; i < z.length; i++) {
      let s = bias;
      for (let d = 0; d < dims; d++) s += weights[d]! * z[i]![d]!;
      const error = 1 / (1 + Math.exp(-s)) - y[i]!;
      for (let d = 0; d < dims; d++) grad[d]! += error * z[i]![d]!;
      gradBias += error;
    }
    for (let d = 0; d < dims; d++) weights[d]! -= RATE * (grad[d]! / z.length + L2 * weights[d]!);
    bias -= (RATE * gradBias) / z.length;
  }
  const score = (x: readonly number[]) => x.reduce((s, v, d) => s + weights[d]! * ((v - mean[d]!) / std[d]!), bias);
  return { mean, std, weights, bias, score };
}

/** Index of the highest score; the earlier one on a tie, as the bot does. */
function argmax(scores: number[]): number {
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
  return best;
}

const started = performance.now();
const rng = createRng(SEED);
const moves: Move[] = Array.from({ length: GAMES }, () => oneMove(rng));
console.log(`Played ${GAMES} seeded games in ${((performance.now() - started) / 1000).toFixed(1)} s`);

const split = Math.floor(GAMES * 0.8);
const train = moves.slice(0, split);
const test = moves.slice(split);
const trainLabels = train.flatMap((m) => m.mines);
const fitStarted = performance.now();
const fly = fitLogistic(train.flatMap((m) => m.outputs), trainLabels);
const raw = fitLogistic(train.flatMap((m) => m.features), trainLabels);
console.log(
  `Fitted both readouts on ${trainLabels.length} candidates in ${((performance.now() - fitStarted) / 1000).toFixed(1)} s`,
);

const rate = (hits: number) => hits / test.length;
let flyHits = 0;
let rawHits = 0;
let solverHits = 0;
let randomHits = 0;
let candidateTotal = 0;
for (const move of test) {
  if (move.mines[argmax(move.outputs.map(fly.score))]) flyHits++;
  if (move.mines[argmax(move.features.map(raw.score))]) rawHits++;
  if (move.mines[argmax(move.solverChance)]) solverHits++;
  randomHits += move.mines.filter(Boolean).length / move.mines.length;
  candidateTotal += move.mines.length;
}

// How lively the output layer is: rates stuck at 0 or 1 carry no information.
const allOutputs = moves.flatMap((m) => m.outputs.flat());
const stuck = allOutputs.filter((r) => r <= 0 || r >= 1).length / allOutputs.length;

// What one fly move costs on this machine, through the real `flyMove` (every candidate scored).
const outputIds = circuit.neurons.filter((n) => n.role === 'output').map((n) => n.id);
const flyReadout: FlyReadout = { outputIds, mean: fly.mean, std: fly.std, weights: fly.weights, bias: fly.bias };
const trained = new FlyBrain(circuit, flyReadout);
function cost(rows: number, cols: number, mineCount: number, games: number) {
  const costRng = createRng(SEED + rows);
  const spots = Array.from(
    { length: games },
    () => playUntil(rows, cols, mineCount, Math.floor(rows * cols * (0.15 + 0.4 * costRng())), costRng).view,
  );
  const timer = performance.now();
  let candidates = 0;
  for (const view of spots) candidates += flyMove(trained, view, 'hard', costRng)!.candidates.length;
  return { ms: (performance.now() - timer) / games, candidates: candidates / games };
}
const small = cost(6, 6, 11, 100);
const bigBoard = aiBoard(16, 'classic');
const big = cost(bigBoard.rows, bigBoard.cols, bigBoard.mineCount, 20);

const round = (x: number) => Number(x.toPrecision(6));
const results = {
  testMoves: test.length,
  averageCandidates: round(candidateTotal / test.length),
  flyPickIsMine: round(rate(flyHits)),
  readoutWithoutCircuitIsMine: round(rate(rawHits)),
  randomCandidateIsMine: round(rate(randomHits)),
  solverBestAmongCandidatesIsMine: round(rate(solverHits)),
  outputRatesAt0or1: round(stuck),
  msPerMove6x6: round(small.ms),
  msPerMove16x16: round(big.ms),
  candidatesPerMove6x6: round(small.candidates),
  candidatesPerMove16x16: round(big.candidates),
};

const readout = {
  format: 2,
  trainedOn,
  script: 'scripts/fly/train.ts',
  circuit: { dataset: circuit.provenance.dataset, fetchedOn: circuit.provenance.fetchedOn },
  features: FLY_FEATURES,
  games: {
    train: train.length,
    test: test.length,
    seed: SEED,
    board: `${CLASSIC_PRESET.rows}x${CLASSIC_PRESET.cols}, ${CLASSIC_PRESET.mineCount} mines`,
  },
  outputIds,
  mean: fly.mean.map(round),
  std: fly.std.map(round),
  weights: fly.weights.map(round),
  bias: round(fly.bias),
  results,
};
writeFileSync(OUT, `${JSON.stringify(readout, null, 2)}\n`);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`
Held-out games: ${test.length} (trained on ${train.length}); about ${results.averageCandidates.toFixed(1)} candidates per move
  How often the pick is a mine:
    Fruit Fly (circuit + trained readout)   ${pct(results.flyPickIsMine)}
    Same readout, raw features, no circuit  ${pct(results.readoutWithoutCircuitIsMine)}
    A random candidate                      ${pct(results.randomCandidateIsMine)}
    Solver's best cell (reference only, the fly never sees it)  ${pct(results.solverBestAmongCandidatesIsMine)}
  Output rates pinned at 0 or 1             ${pct(results.outputRatesAt0or1)}
  One move on this machine: 6x6 ~${results.msPerMove6x6.toFixed(2)} ms (${results.candidatesPerMove6x6.toFixed(0)} cells), 16x16 ~${results.msPerMove16x16.toFixed(1)} ms (${results.candidatesPerMove16x16.toFixed(0)} cells)
Saved → ${OUT}`);
