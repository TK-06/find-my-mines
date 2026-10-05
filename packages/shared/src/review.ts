import { puzzleCellLabel } from './engine/puzzle.js';
import { mineProbabilities, type ProbabilityGrid, type SolverCell } from './engine/solver.js';
import { replayAdjacency, replayComplete, type Replay } from './replay.js';
import type { Rating } from './reviewText.js';

/**
 * Game review: how well each move was chosen, worked out after the match from
 * what the player could see when they made it.
 *
 * In this game finding a mine scores a point and keeps the turn, so the best
 * move is always the covered cell most likely to be a mine. For every move the
 * solver is run on the PUBLIC view at that moment — the cells already opened
 * and their numbers, never where the mines really were — and the cell that was
 * opened is compared with the likeliest one. Pure and I/O-free: the browser
 * runs it for the review screen and the server runs it for the coach.
 */

/** A pick this close to the best chance (or closer) is a Best move; ties count. */
export const BEST_SHARE = 0.995;
export const GOOD_SHARE = 0.8;
export const RISKY_SHARE = 0.5;

/** A chance at or above this is a sure mine: the solver gives exactly 1 for those, this only absorbs rounding. */
const SURE = 1 - 1e-9;

/** Chances closer than this are the same chance. */
const TIE = 1e-12;

/** Absorbs float rounding at a rating's edge: a share of 0.7999999999 is a share of 0.8. */
const EDGE = 1e-9;

/**
 * How much of the best chance a pick had, 0–1. When even the best cell has no
 * chance (nothing to choose between) every pick is as good as any other.
 */
export function moveShare(picked: number, best: number): number {
  if (!(best > 0)) return 1;
  return Math.min(1, Math.max(0, picked / best));
}

/** The rating for a pick, given its chance of being a mine and the best chance on the board. */
export function rateMove(picked: number, best: number): Rating {
  if (best >= SURE && picked < SURE) return 'missed';
  const share = moveShare(picked, best);
  if (share >= BEST_SHARE - EDGE) return 'best';
  if (share >= GOOD_SHARE - EDGE) return 'good';
  if (share >= RISKY_SHARE - EDGE) return 'risky';
  return 'blunder';
}

export interface MoveReview {
  /** The move's number, from 1. */
  n: number;
  /** Who made it: an index into the replay's seats. */
  seat: number;
  /** The cell opened, as a row-major index. */
  cell: number;
  /** The cell's name on the board's rulers, e.g. "F1". */
  label: string;
  result: 'mine' | 'empty';
  /** The number the cell showed. 0 for a mine, which shows no number. */
  adjacent: number;
  /** The chance, just before the move, that the cell opened was a mine (0–1). */
  pickedOdds: number;
  /** The best chance of any covered cell, just before the move. */
  bestOdds: number;
  /** The likeliest cell. The cell opened itself when it was tied for likeliest. */
  bestCell: number;
  bestLabel: string;
  rating: Rating;
  /** Every seat's score just before this move. */
  scores: number[];
}

export interface SeatReview {
  seat: number;
  name: string;
  bot: boolean;
  /** Mines found. */
  score: number;
  /** Mean share of the best chance over this seat's moves, in percent; null when they made none. */
  accuracy: number | null;
  counts: Record<Rating, number>;
  moves: number;
}

export type KeyMomentKind = 'missed-sure' | 'run' | 'lead-change' | 'deciding';

export interface KeyMoment {
  kind: KeyMomentKind;
  /** The move to jump to, from 1. */
  move: number;
  seat: number;
  /** run: the last move of the run. */
  endMove?: number;
  /** run: how many mines in a row. */
  length?: number;
  /** lead-change: the seat that lost the lead. */
  from?: number;
  /** missed-sure: what was opened, and the sure mine it passed over. */
  label?: string;
  sureLabel?: string;
  /** missed-sure: the chance the pick had (0–1). */
  pickedOdds?: number;
}

export interface Review {
  moves: MoveReview[];
  /** odds[i]: every covered cell's chance of being a mine just BEFORE move i + 1; null where already open. */
  odds: ProbabilityGrid[];
  seats: SeatReview[];
  moments: KeyMoment[];
  /** Every mine was found. False for a match cut short by someone leaving. */
  complete: boolean;
  /** The seat with the most mines when the match was played out and no one tied it; otherwise null. */
  winner: number | null;
}

/** The most of each kind of key moment kept, so a long game does not bury its story. */
const MAX_MISSED_MOMENTS = 3;
const MAX_RUN_MOMENTS = 2;
const MAX_LEAD_MOMENTS = 3;

/** A run is this many mines in a row by one seat, at least. */
export const RUN_MIN = 3;

function emptyCounts(): Record<Rating, number> {
  return { best: 0, good: 0, risky: 0, blunder: 0, missed: 0 };
}

/** One unfinished analysis: step it move by move (to yield between moves), then finish. */
export interface ReviewRun {
  /** How many moves there are to analyse. */
  readonly total: number;
  /** How many have been analysed. */
  readonly done: number;
  /** Analyses the next move. False once there are none left. */
  step(): boolean;
  /** The finished review. Steps through whatever is left first. */
  finish(): Review;
}

/**
 * Starts analysing a replay. Each `step` runs the solver once on the view at
 * that move — up to ~20 ms on a crowded 16×16 board — so a caller with a
 * screen or an event loop to keep alive steps in between other work.
 */
export function startReview(replay: Replay): ReviewRun {
  const { rows, cols, mineCount } = replay;
  const isMine = new Uint8Array(rows * cols);
  for (const cell of replay.mines) isMine[cell] = 1;
  const adjacency = replayAdjacency(replay);

  const revealed: SolverCell[] = [];
  const scores = replay.seats.map(() => 0);
  const moves: MoveReview[] = [];
  const odds: ProbabilityGrid[] = [];

  const step = (): boolean => {
    const move = replay.moves[moves.length];
    if (!move) return false;

    // What the players could see just before this move: the opened cells and
    // their numbers. The mines are not in it.
    const grid = mineProbabilities({ rows, cols, mineCount, revealed });
    const row = Math.floor(move.i / cols);
    const col = move.i % cols;
    const pickedOdds = grid[row]?.[col] ?? 0;

    let bestOdds = -1;
    let bestCell = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const chance = grid[r]![c];
        if (chance === null || chance === undefined) continue;
        if (chance > bestOdds + TIE) {
          bestOdds = chance;
          bestCell = r * cols + c;
        }
      }
    }
    if (bestCell < 0) {
      // Nothing was covered, which a valid replay never shows; keep the move readable anyway.
      bestOdds = pickedOdds;
      bestCell = move.i;
    } else if (pickedOdds >= bestOdds - TIE) {
      bestCell = move.i;
      bestOdds = Math.max(bestOdds, pickedOdds);
    }

    const mine = isMine[move.i] === 1;
    moves.push({
      n: moves.length + 1,
      seat: move.s,
      cell: move.i,
      label: puzzleCellLabel({ row, col }),
      result: mine ? 'mine' : 'empty',
      adjacent: mine ? 0 : adjacency[move.i]!,
      pickedOdds,
      bestOdds,
      bestCell,
      bestLabel: puzzleCellLabel({ row: Math.floor(bestCell / cols), col: bestCell % cols }),
      rating: rateMove(pickedOdds, bestOdds),
      scores: [...scores],
    });
    odds.push(grid);

    revealed.push({ row, col, kind: mine ? 'bomb' : 'empty', adjacent: mine ? 0 : adjacency[move.i]! });
    if (mine) scores[move.s]!++;
    return true;
  };

  return {
    total: replay.moves.length,
    get done() {
      return moves.length;
    },
    step,
    finish() {
      while (step());
      return summarise(replay, moves, odds);
    },
  };
}

/** The whole review in one go. For tests and small boards; a screen should step it (see startReview). */
export function reviewMatch(replay: Replay, onProgress?: (done: number, total: number) => void): Review {
  const run = startReview(replay);
  while (run.step()) onProgress?.(run.done, run.total);
  return run.finish();
}

export interface ReviewPacing {
  /** Awaited between moves: hands the thread back to the page or the event loop. */
  pause: () => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  /** Checked between moves; true stops the work and resolves null. */
  cancelled?: () => boolean;
}

/**
 * A `pause` for `reviewMatchAsync` that costs nothing until `budgetMs` of work
 * has piled up since the last real pause, and then lets the host (the browser
 * or the server's event loop) run before carrying on. A review of a long game
 * is a few hundred solver calls, most of them well under a millisecond: this
 * keeps each stretch short without paying for a hand-back after every move.
 * `yieldToHost` and `now` are passed in, so the thread-handing part is the
 * caller's and the timing is testable.
 */
export function timeSlicedPause(
  yieldToHost: () => Promise<void>,
  now: () => number,
  budgetMs = 10,
): () => Promise<void> {
  let sliceStart = now();
  return async () => {
    if (now() - sliceStart < budgetMs) return;
    await yieldToHost();
    sliceStart = now();
  };
}

/** The review, yielding between moves so the page (or the server) stays responsive. */
export async function reviewMatchAsync(replay: Replay, pacing: ReviewPacing): Promise<Review | null> {
  const run = startReview(replay);
  while (run.step()) {
    pacing.onProgress?.(run.done, run.total);
    if (pacing.cancelled?.()) return null;
    await pacing.pause();
  }
  return run.finish();
}

/** Totals and key moments from the analysed moves. */
function summarise(replay: Replay, moves: readonly MoveReview[], odds: ProbabilityGrid[]): Review {
  const seats: SeatReview[] = replay.seats.map((seat, index) => ({
    seat: index,
    name: seat.name,
    bot: seat.bot,
    score: 0,
    accuracy: null,
    counts: emptyCounts(),
    moves: 0,
  }));
  const shares = replay.seats.map(() => 0);
  for (const move of moves) {
    const seat = seats[move.seat]!;
    seat.moves++;
    seat.counts[move.rating]++;
    if (move.result === 'mine') seat.score++;
    shares[move.seat]! += moveShare(move.pickedOdds, move.bestOdds);
  }
  for (const seat of seats) {
    // One decimal, so a 99.6% game is not rounded up to a perfect 100.
    seat.accuracy = seat.moves > 0 ? Math.round((shares[seat.seat]! / seat.moves) * 1000) / 10 : null;
  }

  const complete = replayComplete(replay);
  const top = Math.max(...seats.map((seat) => seat.score));
  const leaders = seats.filter((seat) => seat.score === top);
  const winner = complete && leaders.length === 1 ? leaders[0]!.seat : null;

  return { moves: [...moves], odds, seats, moments: keyMoments(replay, moves, winner), complete, winner };
}

/** The moments worth jumping to, in move order. */
function keyMoments(replay: Replay, moves: readonly MoveReview[], winner: number | null): KeyMoment[] {
  const moments: KeyMoment[] = [];

  // Sure mines left lying: the costliest few.
  moves
    .filter((move) => move.rating === 'missed')
    .sort((a, b) => b.bestOdds - b.pickedOdds - (a.bestOdds - a.pickedOdds) || a.n - b.n)
    .slice(0, MAX_MISSED_MOMENTS)
    .forEach((move) =>
      moments.push({
        kind: 'missed-sure',
        move: move.n,
        seat: move.seat,
        label: move.label,
        sureLabel: move.bestLabel,
        pickedOdds: move.pickedOdds,
      }),
    );

  // Runs of mines by one seat: the longest few.
  const runs: KeyMoment[] = [];
  for (let start = 0; start < moves.length; ) {
    let end = start;
    while (end < moves.length && moves[end]!.seat === moves[start]!.seat && moves[end]!.result === 'mine') end++;
    const length = end - start;
    if (length >= RUN_MIN) {
      runs.push({ kind: 'run', move: moves[start]!.n, endMove: moves[end - 1]!.n, seat: moves[start]!.seat, length });
    }
    start = Math.max(end, start + 1);
  }
  runs.sort((a, b) => b.length! - a.length! || a.move - b.move).slice(0, MAX_RUN_MOMENTS).forEach((run) => moments.push(run));

  // Lead changes: someone takes the lead from whoever had it last. A tie is
  // not a lead, so a lead lost and won back through a tie is no change.
  const scores = replay.seats.map(() => 0);
  let leader: number | null = null;
  const changes: KeyMoment[] = [];
  for (const move of moves) {
    if (move.result !== 'mine') continue;
    scores[move.seat]!++;
    const top = Math.max(...scores);
    const leaders = scores.flatMap((score, seat) => (score === top ? [seat] : []));
    if (leaders.length !== 1) continue;
    const next = leaders[0]!;
    if (leader !== null && next !== leader) changes.push({ kind: 'lead-change', move: move.n, seat: next, from: leader });
    leader = next;
  }

  // The deciding mine: the one after which the winner's lead is bigger than the
  // mines still hidden, so nobody can catch up any more.
  let deciding: KeyMoment | null = null;
  if (winner !== null) {
    const running = replay.seats.map(() => 0);
    let found = 0;
    for (const move of moves) {
      if (move.result !== 'mine') continue;
      running[move.seat]!++;
      found++;
      const others = Math.max(...running.filter((_, seat) => seat !== winner));
      if (running[winner]! - others > replay.mineCount - found) {
        deciding = { kind: 'deciding', move: move.n, seat: winner };
        break;
      }
    }
  }

  changes
    .filter((change) => change.move !== deciding?.move)
    .slice(-MAX_LEAD_MOMENTS)
    .forEach((change) => moments.push(change));
  if (deciding) moments.push(deciding);

  const order: Record<KeyMomentKind, number> = { 'missed-sure': 0, run: 1, 'lead-change': 2, deciding: 3 };
  return moments.sort((a, b) => a.move - b.move || order[a.kind] - order[b.kind]);
}
