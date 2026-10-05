import { describe, expect, it } from 'vitest';
import { parseCellLabel } from './coach.js';
import { mineProbabilities } from './engine/solver.js';
import { parseReplay, type Replay } from './replay.js';
import {
  moveShare,
  rateMove,
  reviewMatch,
  reviewMatchAsync,
  startReview,
  timeSlicedPause,
} from './review.js';
import { RATINGS, RATING_LABELS, momentClause, momentSentence, momentTitle, momentWhen, percentOf } from './reviewText.js';

/**
 * A hand-made replay from cell labels. Boards here are tiny, often one row
 * tall, so the chance of each cell can be worked out by hand and checked
 * against the solver.
 */
function replayOf(
  rows: number,
  cols: number,
  mines: string[],
  moves: [string, number][],
  seats = 2,
): Replay {
  const at = (label: string) => parseCellLabel(label, rows, cols)!;
  const replay = parseReplay({
    v: 1,
    rows,
    cols,
    mineCount: mines.length,
    mines: mines.map(at),
    seats: Array.from({ length: seats }, (_, i) => ({ name: `P${i + 1}`, bot: false })),
    moves: moves.map(([label, seat]) => ({ i: at(label), s: seat })),
  });
  if (!replay) throw new Error('the test replay is not valid');
  return replay;
}

/**
 * 1 × 5, mines at A1 and C1. B1 shows 2, so A1 and C1 are sure mines; P2 then
 * opens D1 (a safe cell) instead, and P1 collects both mines.
 */
const SURE_MINES = replayOf(1, 5, ['A1', 'C1'], [['B1', 0], ['D1', 1], ['A1', 0], ['C1', 0]]);

describe('rateMove and moveShare', () => {
  it('takes the best chance as 100% and scales the pick against it', () => {
    expect(moveShare(0.25, 0.5)).toBeCloseTo(0.5);
    expect(moveShare(0.5, 0.5)).toBe(1);
    expect(moveShare(0.7, 0.5)).toBe(1);
    expect(moveShare(0, 0.5)).toBe(0);
  });

  it('counts nothing to choose between as a perfect pick', () => {
    expect(moveShare(0, 0)).toBe(1);
    expect(rateMove(0, 0)).toBe('best');
  });

  it('rates by how much of the best chance the pick had', () => {
    expect(rateMove(0.5, 0.5)).toBe('best');
    expect(rateMove(0.4975, 0.5)).toBe('best'); // 99.5% of the best, tied for it
    expect(rateMove(0.4, 0.5)).toBe('good'); // 80%
    expect(rateMove(0.45, 0.5)).toBe('good');
    expect(rateMove(0.3, 0.5)).toBe('risky'); // 60%
    expect(rateMove(0.25, 0.5)).toBe('risky'); // 50%
    expect(rateMove(0.2, 0.5)).toBe('blunder'); // 40%
    expect(rateMove(0, 0.5)).toBe('blunder');
  });

  it('calls a pick below a sure mine "missed", however good the pick was otherwise', () => {
    expect(rateMove(0, 1)).toBe('missed');
    expect(rateMove(0.9, 1)).toBe('missed');
    expect(rateMove(0.999, 1)).toBe('missed');
    expect(rateMove(1, 1)).toBe('best');
  });

  it('does not call it "missed" when the best chance is only high', () => {
    expect(rateMove(0.2, 0.95)).toBe('blunder');
    expect(rateMove(0.9, 0.95)).toBe('good');
  });

  it('names every rating', () => {
    for (const rating of RATINGS) expect(RATING_LABELS[rating]).toBeTruthy();
    expect(RATING_LABELS.missed).toBe('Missed a sure mine');
  });
});

describe('reviewMatch: moves', () => {
  it('rates a first move Best — every covered cell is equally likely', () => {
    const review = reviewMatch(SURE_MINES);
    const first = review.moves[0]!;
    expect(first).toMatchObject({ n: 1, seat: 0, label: 'B1', result: 'empty', adjacent: 2, rating: 'best' });
    expect(first.pickedOdds).toBeCloseTo(0.4); // 2 mines in 5 cells
    expect(first.bestOdds).toBeCloseTo(0.4);
    // Tied for the best, so the pick is the best cell.
    expect(first.bestCell).toBe(first.cell);
    expect(first.scores).toEqual([0, 0]);
  });

  it('rates opening a safe cell when a sure mine is on the board "Missed a sure mine"', () => {
    const miss = reviewMatch(SURE_MINES).moves[1]!;
    expect(miss).toMatchObject({ n: 2, seat: 1, label: 'D1', result: 'empty', adjacent: 1, rating: 'missed' });
    expect(miss.pickedOdds).toBe(0);
    expect(miss.bestOdds).toBe(1);
    // The sure mine is named: the first one in reading order.
    expect(miss.bestLabel).toBe('A1');
  });

  it('rates taking a sure mine Best, and records the score before each move', () => {
    const { moves } = reviewMatch(SURE_MINES);
    expect(moves[2]).toMatchObject({ label: 'A1', result: 'mine', adjacent: 0, rating: 'best', pickedOdds: 1, scores: [0, 0] });
    expect(moves[3]).toMatchObject({ label: 'C1', result: 'mine', rating: 'best', scores: [1, 0] });
  });

  it('rates Good: 90% of the best chance', () => {
    // 3 × 5, mines C2, A1, B1. After D3 opens, C2 is 20% against a best of 22%.
    const review = reviewMatch(replayOf(3, 5, ['C2', 'A1', 'B1'], [['D3', 0], ['C2', 1]]));
    const move = review.moves[1]!;
    expect(move.rating).toBe('good');
    expect(move.pickedOdds).toBeCloseTo(0.2);
    expect(move.bestOdds).toBeCloseTo(2 / 9);
    expect(move.bestLabel).toBe('A1');
    expect(review.seats[1]!.accuracy).toBe(90);
  });

  it('rates Risky: two thirds of the best chance', () => {
    // 1 × 6, mines A1, B1. C1 shows 1: B1 and D1 are 50% each; A1 is 33%.
    const review = reviewMatch(replayOf(1, 6, ['A1', 'B1'], [['C1', 0], ['A1', 1]]));
    const move = review.moves[1]!;
    expect(move.rating).toBe('risky');
    expect(move.pickedOdds).toBeCloseTo(1 / 3);
    expect(move.bestOdds).toBeCloseTo(0.5);
    expect(review.seats[1]!.accuracy).toBe(66.7);
  });

  it('rates Blunder: opening a cell the numbers prove safe while mines are likelier elsewhere', () => {
    // D1 shows 0, so C1 and E1 are safe; the mines are likelier elsewhere (best 67%, not certain).
    const review = reviewMatch(replayOf(1, 6, ['A1', 'B1'], [['D1', 0], ['C1', 1]]));
    const move = review.moves[1]!;
    expect(move.rating).toBe('blunder');
    expect(move.pickedOdds).toBe(0);
    expect(move.bestOdds).toBeCloseTo(2 / 3);
    expect(review.seats[1]!.accuracy).toBe(0);
  });

  it('gives every move the odds grid it was chosen from: covered cells only, none of the mines', () => {
    const review = reviewMatch(SURE_MINES);
    expect(review.odds).toHaveLength(4);
    // Before move 1 nothing is open: every cell is a 40% guess, wherever the mines are.
    expect(review.odds[0]![0]!.every((chance) => chance !== null && Math.abs(chance - 0.4) < 1e-9)).toBe(true);
    // Before move 2, B1 is open (null), A1 and C1 are certain, D1 and E1 are safe.
    expect(review.odds[1]![0]).toEqual([1, null, 1, 0, 0]);
    // The grid is what the solver says about the public view, nothing more.
    const view = { rows: 1, cols: 5, mineCount: 2, revealed: [{ row: 0, col: 1, kind: 'empty' as const, adjacent: 2 }] };
    expect(review.odds[1]).toEqual(mineProbabilities(view));
  });

  it('never looks at where the mines are: same openings, different hidden mines, same odds', () => {
    // A1 and C1 versus A1 and E1 differ only in cells nobody has opened yet.
    const a = reviewMatch(replayOf(1, 6, ['A1', 'C1'], [['F1', 0], ['E1', 1]]));
    const b = reviewMatch(replayOf(1, 6, ['A1', 'E1'], [['F1', 0], ['C1', 1]]));
    expect(a.odds[0]).toEqual(b.odds[0]);
  });

  it('handles a replay with no moves', () => {
    const review = reviewMatch(replayOf(1, 4, ['A1'], []));
    expect(review.moves).toEqual([]);
    expect(review.seats.map((seat) => seat.accuracy)).toEqual([null, null]);
    expect(review.moments).toEqual([]);
    expect(review.complete).toBe(false);
  });
});

describe('reviewMatch: seats', () => {
  it('totals each seat: score, accuracy, and how many moves earned each rating', () => {
    const { seats } = reviewMatch(SURE_MINES);
    expect(seats[0]).toMatchObject({
      seat: 0,
      name: 'P1',
      bot: false,
      score: 2,
      accuracy: 100,
      moves: 3,
      counts: { best: 3, good: 0, risky: 0, blunder: 0, missed: 0 },
    });
    expect(seats[1]).toMatchObject({
      seat: 1,
      score: 0,
      accuracy: 0,
      moves: 1,
      counts: { best: 0, good: 0, risky: 0, blunder: 0, missed: 1 },
    });
  });

  it('averages the share of the best chance over a seat’s moves, keeping one decimal', () => {
    const { seats } = reviewMatch(
      replayOf(3, 5, ['C2', 'A1', 'B1'], [['D3', 0], ['C2', 1]]),
    );
    // P1 made one best move; P2 one move at 90% of the best.
    expect(seats[0]!.accuracy).toBe(100);
    expect(seats[1]!.accuracy).toBe(90);
  });

  it('names the winner only when the match was played out and nobody tied', () => {
    expect(reviewMatch(SURE_MINES).winner).toBe(0);
    expect(reviewMatch(SURE_MINES).complete).toBe(true);
    // 1 × 4, two mines found one each: a draw.
    const draw = reviewMatch(replayOf(1, 4, ['A1', 'D1'], [['A1', 0], ['D1', 1]]));
    expect(draw.complete).toBe(true);
    expect(draw.winner).toBeNull();
  });
});

describe('reviewMatch: key moments', () => {
  it('finds a missed sure mine, with what was opened and what was passed over', () => {
    const { moments } = reviewMatch(SURE_MINES);
    expect(moments).toContainEqual({
      kind: 'missed-sure',
      move: 2,
      seat: 1,
      label: 'D1',
      sureLabel: 'A1',
      pickedOdds: 0,
    });
  });

  it('finds the deciding mine: the one after which nobody can catch up', () => {
    const { moments } = reviewMatch(SURE_MINES);
    // 2 mines in all: after P1 takes the second, 2 - 0 is more than the 0 left.
    expect(moments.at(-1)).toEqual({ kind: 'deciding', move: 4, seat: 0 });
  });

  it('has no deciding mine in a draw or a match cut short', () => {
    const draw = reviewMatch(replayOf(1, 4, ['A1', 'D1'], [['A1', 0], ['D1', 1]]));
    expect(draw.moments.some((moment) => moment.kind === 'deciding')).toBe(false);
    const cut = reviewMatch(replayOf(1, 5, ['A1', 'C1'], [['B1', 0], ['D1', 1], ['A1', 0]]));
    expect(cut.complete).toBe(false);
    expect(cut.moments.some((moment) => moment.kind === 'deciding')).toBe(false);
  });

  it('keeps a match cut short readable: moves, accuracy and a missed sure mine still show', () => {
    const cut = reviewMatch(replayOf(1, 5, ['A1', 'C1'], [['B1', 0], ['D1', 1], ['A1', 0]]));
    expect(cut.moves).toHaveLength(3);
    expect(cut.winner).toBeNull();
    expect(cut.seats.map((seat) => seat.score)).toEqual([1, 0]);
    expect(cut.moments.map((moment) => moment.kind)).toEqual(['missed-sure']);
  });

  /**
   * Three seats on a 1 × 10 board with seven mines (A1–G1) and safe H1–J1.
   * P1 takes A1 and opens H1; P2 takes B1, C1, D1 (a run of three), opens I1;
   * P3 opens J1; P1 takes E1, F1, G1 and wins 4–3.
   */
  const FREE_FOR_ALL = replayOf(
    1,
    10,
    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1'],
    [
      ['A1', 0], ['H1', 0],
      ['B1', 1], ['C1', 1], ['D1', 1], ['I1', 1],
      ['J1', 2],
      ['E1', 0], ['F1', 0], ['G1', 0],
    ],
    3,
  );

  it('reviews a free-for-all: runs, a lead change, a missed mine and the deciding mine, in move order', () => {
    const review = reviewMatch(FREE_FOR_ALL);
    expect(review.seats.map((seat) => seat.score)).toEqual([4, 3, 0]);
    expect(review.winner).toBe(0);
    expect(review.moments).toEqual([
      { kind: 'run', move: 3, endMove: 5, seat: 1, length: 3 },
      { kind: 'lead-change', move: 4, seat: 1, from: 0 },
      { kind: 'missed-sure', move: 7, seat: 2, label: 'J1', sureLabel: 'E1', pickedOdds: 0 },
      { kind: 'run', move: 8, endMove: 10, seat: 0, length: 3 },
      { kind: 'deciding', move: 10, seat: 0 },
    ]);
  });

  it('counts a run only from three mines in a row by one seat', () => {
    const { moments } = reviewMatch(SURE_MINES);
    // P1 found two in a row (A1, C1): not a run.
    expect(moments.some((moment) => moment.kind === 'run')).toBe(false);
  });

  it('counts a lead change only when someone takes the lead from the last leader — a tie is not a lead', () => {
    const { moments } = reviewMatch(FREE_FOR_ALL);
    // P1 led, P2 tied it and then led (change at move 4); P1 tied at move 9
    // and led again at move 10, which is also the deciding mine and is listed once, as that.
    expect(moments.filter((moment) => moment.kind === 'lead-change').map((moment) => moment.move)).toEqual([4]);
    expect(moments.filter((moment) => moment.move === 10).map((moment) => moment.kind)).toEqual(['deciding']);
  });

  it('does not count the first lead as a change', () => {
    // P1 finds the first mine and leads from the start: nobody took anything from anyone.
    const { moments } = reviewMatch(SURE_MINES);
    expect(moments.some((moment) => moment.kind === 'lead-change')).toBe(false);
  });

  it('reports a lead won back through a tie as no change', () => {
    // P1, then P2 ties, then P1 again: P1 never lost the lead.
    const review = reviewMatch(
      replayOf(
        1,
        8,
        ['A1', 'B1', 'C1'],
        [['A1', 0], ['H1', 0], ['B1', 1], ['G1', 1], ['C1', 0]],
      ),
    );
    expect(review.moments.some((moment) => moment.kind === 'lead-change')).toBe(false);
  });
});

describe('reviewMatch: pacing', () => {
  it('gives the same review step by step as in one go', () => {
    const run = startReview(SURE_MINES);
    expect(run.total).toBe(4);
    let steps = 0;
    while (run.step()) steps++;
    expect(steps).toBe(4);
    expect(run.done).toBe(4);
    expect(run.finish()).toEqual(reviewMatch(SURE_MINES));
  });

  it('reports progress after each move', () => {
    const seen: [number, number][] = [];
    reviewMatch(SURE_MINES, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  it('hands the thread back between moves, and finishes with the same review', async () => {
    let pauses = 0;
    const review = await reviewMatchAsync(SURE_MINES, {
      pause: async () => {
        pauses++;
      },
    });
    expect(pauses).toBe(4);
    expect(review).toEqual(reviewMatch(SURE_MINES));
  });

  it('stops when told to, and says so', async () => {
    let steps = 0;
    const review = await reviewMatchAsync(SURE_MINES, {
      pause: async () => undefined,
      onProgress: () => steps++,
      cancelled: () => steps >= 2,
    });
    expect(review).toBeNull();
    expect(steps).toBe(2);
  });
});

describe('timeSlicedPause', () => {
  it('lets the host run only once the time budget is used up', async () => {
    let clock = 0;
    let handBacks = 0;
    const pause = timeSlicedPause(
      async () => {
        handBacks++;
      },
      () => clock,
      10,
    );

    await pause();
    clock = 9;
    await pause();
    expect(handBacks).toBe(0);

    clock = 10;
    await pause();
    expect(handBacks).toBe(1);

    // The budget starts again from the hand-back.
    clock = 15;
    await pause();
    expect(handBacks).toBe(1);
    clock = 20;
    await pause();
    expect(handBacks).toBe(2);
  });

  it('works as the pause of a review', async () => {
    let handBacks = 0;
    let clock = 0;
    const review = await reviewMatchAsync(SURE_MINES, {
      // Each move "takes" 6 ms, so a hand-back comes every second move.
      pause: timeSlicedPause(
        async () => {
          handBacks++;
        },
        () => (clock += 6),
        10,
      ),
    });
    expect(handBacks).toBeGreaterThan(0);
    expect(review).toEqual(reviewMatch(SURE_MINES));
  });
});

describe('describing key moments', () => {
  const names = ['Ann', 'Ben', 'Cy'];

  it('says "you" for the viewer’s own seat and the name for anyone else', () => {
    const missed = { kind: 'missed-sure' as const, move: 9, seat: 0, label: 'F1', sureLabel: 'C2', pickedOdds: 0.4 };
    expect(momentClause(missed, names, 0)).toBe('you missed a sure mine at C2 and opened F1 instead (40%)');
    expect(momentClause(missed, names, 1)).toBe('Ann missed a sure mine at C2 and opened F1 instead (40%)');
    expect(momentClause(missed, names, null)).toBe('Ann missed a sure mine at C2 and opened F1 instead (40%)');
    expect(momentSentence(missed, names, 0)).toBe('move 9, you missed a sure mine at C2 and opened F1 instead (40%)');
  });

  it('describes a run, a lead change and the deciding mine', () => {
    expect(momentClause({ kind: 'run', move: 3, endMove: 5, seat: 1, length: 3 }, names, null)).toBe(
      'Ben found 3 mines in a row',
    );
    expect(momentSentence({ kind: 'run', move: 3, endMove: 5, seat: 1, length: 3 }, names, null)).toBe(
      'moves 3 to 5, Ben found 3 mines in a row',
    );
    expect(momentWhen({ kind: 'missed-sure', move: 9, seat: 0 })).toBe('move 9');
    expect(momentClause({ kind: 'lead-change', move: 4, seat: 1, from: 0 }, names, 0)).toBe('Ben took the lead from you');
    expect(momentClause({ kind: 'deciding', move: 10, seat: 0 }, names, 0)).toContain('you found the mine that decided the game');
  });

  it('titles every kind', () => {
    for (const kind of ['missed-sure', 'run', 'lead-change', 'deciding'] as const) {
      expect(momentTitle(kind).length).toBeGreaterThan(3);
    }
  });

  it('shows a percent as a whole number, 100 only when certain, 0 only when impossible', () => {
    expect(percentOf(1)).toBe(100);
    expect(percentOf(0.999)).toBe(99);
    expect(percentOf(0.4)).toBe(40);
    expect(percentOf(0.001)).toBe(1);
    expect(percentOf(0)).toBe(0);
  });
});
