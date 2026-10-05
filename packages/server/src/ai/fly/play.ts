import {
  cellLabel,
  type AiLevel,
  randomInt,
  type CellRef,
  type Rng,
  type SolverView,
} from '@fmm/shared';
import type { FlyBrain } from './brain.js';
import { flyCandidatesAll, flyFeatures } from './features.js';

/**
 * How the Fruit Fly bot plays a move: which cells it chooses between, how it
 * chooses, and what it buzzes in the chat. Pure — the bot controller supplies
 * the public board and the random numbers.
 */

/** Chance the fly says something after a move, when no language model gave it a line. */
export const FLY_CHAT_CHANCE = 0.35;

/**
 * How sleepy the fly is: the temperature its readout scores are divided by
 * before it samples a cell (softmax). Hard takes its top-scoring cell (0, no
 * sampling). A higher temperature flattens the odds, so the fly more often
 * opens a cell its own neurons rated lower — easier means sleepier. The scores
 * are log-odds of mine, so at 1 a cell rated twice as likely is picked about
 * twice as often. Tuned by scripts/fly/arena.ts; see its output for the data.
 */
export const FLY_TEMPERATURE: Record<AiLevel, number> = { easy: 1.5, medium: 0.6, hard: 0 };

export interface FlyMove {
  pick: CellRef;
  /** The readout's score for each candidate, in the order given. */
  scores: number[];
  candidates: CellRef[];
  /** Present only when asked: the picked cell's step-major neural rates. */
  trace?: Float64Array;
  /** A trace is display-only, so a tracing failure must not change the scored move. */
  traceError?: unknown;
}

export interface FlyMoveOptions {
  /** Record one extra simulation for the picked cell, without affecting the choice. */
  trace?: boolean;
}

/**
 * The fly's move, using its own neurons only. The candidates are every covered
 * cell (or the frontier plus a sample of the rest, see `flyCandidatesAll`);
 * the readout scores each; Hard plays the highest (the earlier on a tie) and
 * the easier levels sample from softmax(score / temperature) using `rng`.
 * Null when nothing is covered.
 */
export function flyMove(
  brain: FlyBrain,
  view: SolverView,
  level: AiLevel,
  rng: Rng,
  options: FlyMoveOptions = {},
): FlyMove | null {
  const candidates = flyCandidatesAll(view, rng);
  if (candidates.length === 0) return null;
  const features = flyFeatures(view, candidates);
  const scores = features.map((row) => brain.score(row));
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;

  let chosen = best;
  const temperature = FLY_TEMPERATURE[level];
  if (temperature > 0 && candidates.length > 1) {
    const top = scores[best]!;
    const weights = scores.map((score) => Math.exp((score - top) / temperature));
    let draw = rng() * weights.reduce((sum, w) => sum + w, 0);
    chosen = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      draw -= weights[i]!;
      if (draw < 0) {
        chosen = i;
        break;
      }
    }
  }
  const { row, col } = candidates[chosen]!;
  const move: FlyMove = {
    pick: { row, col },
    scores,
    candidates,
  };
  if (options.trace) {
    try {
      move.trace = brain.trace(features[chosen]!);
    } catch (error) {
      move.traceError = error;
    }
  }
  return move;
}

const FOUND = [
  'bzz! {cell} smelled like a mine.',
  '*happy buzzing* {cell}!',
  'zzZING. {cell}, just as my neurons said.',
  'bzz bzz. {cell}! the mushroom body knew.',
];

const MISSED = [
  'bzz… {cell}? no?',
  '*confused buzzing* {cell}…',
  '{cell} smelled wrong. bzz.',
  'bzzt. {cell} was empty. back to sniffing.',
];

/** A stock line about the cell the fly just opened. */
export function flyLine(cell: CellRef, foundMine: boolean, rng: Rng): string {
  const lines = foundMine ? FOUND : MISSED;
  return lines[randomInt(rng, lines.length)]!.replace('{cell}', cellLabel(cell));
}
