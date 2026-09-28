import type { ProbabilityGrid } from './engine/solver.js';
import { randomInt, type Rng } from './engine/rng.js';
import type { AiLevel } from './types.js';

export const AI_LEVELS: readonly AiLevel[] = ['easy', 'medium', 'hard'];

/** Hints a player may ask for in one match against the computer. */
export const AI_HINTS_PER_MATCH = 3;

export interface CellRef {
  row: number;
  col: number;
}

/**
 * One computer move before anything asks an LLM: the cells it is choosing
 * between, the one it would pick on its own, and whether this is one of the
 * level's deliberate mistakes.
 */
export interface MovePlan {
  candidates: CellRef[];
  pick: CellRef;
  mistake: boolean;
}

/** The best cell for a hint, and how sure the solver is. */
export interface Hint {
  row: number;
  col: number;
  probability: number;
}

export function isAiLevel(value: unknown): value is AiLevel {
  return typeof value === 'string' && (AI_LEVELS as readonly string[]).includes(value);
}

/** "B3": the column letter and row number the board's rulers show. */
export function cellLabel(cell: CellRef): string {
  return `${String.fromCharCode(65 + cell.col)}${cell.row + 1}`;
}

/** The bot's name on the scoreboard, e.g. "AI · Hard". */
export function botNickname(level: AiLevel): string {
  return `AI · ${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

/** How each level plays. The solver is the same for all three; only the policy differs. */
interface LevelPolicy {
  /** Chance that a move is a deliberate mistake. */
  mistakeRate: number;
  /** A good move picks at random among this many of the likeliest cells. */
  pickFrom: number;
  /** Most cells offered to the LLM on a good move. */
  offer: number;
  /**
   * Offer the LLM only cells as likely as the best, so whichever it chooses is
   * still the best move. A runner-up is added when the best is unique but not
   * certain, so there is still a choice to make; a lone certain mine is
   * offered alone, because taking it is never wrong.
   */
  bestOnly: boolean;
  /** Pause before moving, [min, max] in milliseconds. */
  thinkMs: readonly [number, number];
}

// Think times leave room for a ~2.5 s LLM call inside the 10-second turn.
const POLICY: Record<AiLevel, LevelPolicy> = {
  easy: { mistakeRate: 0.5, pickFrom: 5, offer: 4, bestOnly: false, thinkMs: [2200, 3800] },
  medium: { mistakeRate: 0.2, pickFrom: 1, offer: 3, bestOnly: false, thinkMs: [1400, 2600] },
  hard: { mistakeRate: 0.03, pickFrom: 1, offer: 4, bestOnly: true, thinkMs: [700, 1500] },
};

const MAX_CANDIDATES = 4;

/** A covered cell with its chance, and a rounded key so float noise cannot split a tie. */
interface Ranked extends CellRef {
  probability: number;
  score: number;
}

/**
 * The bot's move, before any LLM is asked: the cells it is choosing between
 * (best first), the one it plays on its own, and whether this is one of the
 * level's deliberate mistakes. Null when nothing is covered.
 *
 * Candidates are two to four distinct covered cells, except where fewer make
 * sense: a single covered cell, a lone certain mine on hard, or a mistake
 * with only one worse cell to choose from.
 */
export function planMove(grid: ProbabilityGrid, level: AiLevel, rng: Rng): MovePlan | null {
  const policy = POLICY[level];
  const cells = rankCells(grid, rng);
  const best = cells[0];
  if (!best) return null;

  // A mistake is a cell the solver rates below the best. When every covered
  // cell is equally likely there is no wrong move to make, so none is made.
  const worse = cells.filter((cell) => cell.score < best.score);
  if (worse.length > 0 && rng() < policy.mistakeRate) {
    const candidates = sample(worse, MAX_CANDIDATES, rng);
    return plan(candidates, candidates[randomInt(rng, candidates.length)]!, true);
  }

  const pick = cells[randomInt(rng, Math.min(policy.pickFrom, cells.length))]!;
  const others = cells.filter((cell) => cell !== pick);
  let offered: Ranked[];
  if (policy.bestOnly) {
    const tied = others.filter((cell) => cell.score === best.score);
    if (tied.length > 0) offered = tied.slice(0, policy.offer - 1);
    else offered = best.probability >= 1 ? [] : others.slice(0, 1);
  } else {
    offered = others.slice(0, policy.offer - 1);
  }
  return plan([pick, ...offered], pick, false);
}

/** How long the bot "thinks" before moving, in milliseconds. */
export function thinkDelayMs(level: AiLevel, rng: Rng): number {
  const [min, max] = POLICY[level].thinkMs;
  return Math.round(min + rng() * (max - min));
}

/**
 * Covered cells, likeliest first. They are shuffled before a stable sort so
 * that equally likely cells come out in random order — otherwise the bot
 * would always open the top-left corner of an even board.
 */
function rankCells(grid: ProbabilityGrid, rng: Rng): Ranked[] {
  const cells: Ranked[] = [];
  grid.forEach((row, r) =>
    row.forEach((probability, c) => {
      if (probability !== null) cells.push({ row: r, col: c, probability, score: Math.round(probability * 1e9) });
    }),
  );
  return sample(cells, cells.length, rng).sort((a, b) => b.score - a.score);
}

/** Up to `count` items in random order (a partial Fisher-Yates on a copy). */
function sample<T>(items: readonly T[], count: number, rng: Rng): T[] {
  const copy = [...items];
  const take = Math.min(count, copy.length);
  for (let i = 0; i < take; i++) {
    const j = i + randomInt(rng, copy.length - i);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, take);
}

function plan(candidates: Ranked[], pick: Ranked, mistake: boolean): MovePlan {
  const cell = (c: Ranked): CellRef => ({ row: c.row, col: c.col });
  return {
    candidates: [...candidates].sort((a, b) => b.score - a.score).map(cell),
    pick: cell(pick),
    mistake,
  };
}

/** The covered cell most likely to be a mine, or null when nothing is covered. */
export function hintFor(grid: ProbabilityGrid): Hint | null {
  let best: Hint | null = null;
  grid.forEach((cells, row) =>
    cells.forEach((probability, col) => {
      if (probability === null) return;
      if (!best || probability > best.probability) best = { row, col, probability };
    }),
  );
  return best;
}

/** The sentence shown with a hint. */
export function describeHint(hint: Hint): string {
  const cell = cellLabel(hint);
  if (hint.probability >= 1) return `${cell} must be a mine — the numbers around it leave no other way.`;
  // Capped at 99 so a cell that is not certain never reads as "100%".
  const percent = Math.min(99, Math.round(hint.probability * 100));
  if (hint.probability >= 0.5) return `${cell} is your best bet: about ${percent}% likely to be a mine.`;
  return `No sure mine left. ${cell} is the likeliest, at about ${percent}%.`;
}
