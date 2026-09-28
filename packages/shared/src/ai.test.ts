import { describe, expect, it } from 'vitest';
import {
  AI_LEVELS,
  cellLabel,
  describeHint,
  hintFor,
  isAiLevel,
  planMove,
  thinkDelayMs,
  type CellRef,
  type MovePlan,
} from './ai.js';
import { createRng, type Rng } from './engine/rng.js';
import type { ProbabilityGrid } from './engine/solver.js';
import type { AiLevel } from './types.js';

const at = (grid: ProbabilityGrid, cell: CellRef): number | null => grid[cell.row]![cell.col]!;
const key = (cell: CellRef): string => `${cell.row}:${cell.col}`;

/** Highest probability among covered cells. */
function bestOf(grid: ProbabilityGrid): number {
  return Math.max(...grid.flat().filter((p): p is number => p !== null));
}

/** A 6x6 grid of mixed probabilities with some cells already open. */
function randomGrid(rng: Rng): ProbabilityGrid {
  return Array.from({ length: 6 }, () =>
    Array.from({ length: 6 }, () => {
      const roll = rng();
      if (roll < 0.25) return null;
      if (roll < 0.35) return 0;
      if (roll < 0.45) return 0.5;
      return Math.round(rng() * 20) / 20;
    }),
  );
}

/** Every covered cell has its own probability, 0.01 apart, so ranks are unambiguous. */
function distinctGrid(): ProbabilityGrid {
  return Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (__, c) => 0.9 - (r * 6 + c) * 0.01));
}

function plans(grid: ProbabilityGrid, level: AiLevel, count: number, seed = 1): MovePlan[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => planMove(grid, level, rng)!);
}

describe('planMove', () => {
  it('returns null when nothing is covered', () => {
    const rng = createRng(1);
    for (const level of AI_LEVELS) {
      expect(planMove([[null, null], [null, null]], level, rng)).toBeNull();
      expect(planMove([], level, rng)).toBeNull();
    }
  });

  it('offers distinct covered candidates that always include the pick', () => {
    const rng = createRng(3);
    for (let i = 0; i < 300; i++) {
      const grid = randomGrid(rng);
      for (const level of AI_LEVELS) {
        const plan = planMove(grid, level, rng);
        if (!plan) continue;
        expect(plan.candidates.length).toBeGreaterThanOrEqual(1);
        expect(plan.candidates.length).toBeLessThanOrEqual(4);
        expect(new Set(plan.candidates.map(key)).size).toBe(plan.candidates.length);
        for (const cell of plan.candidates) expect(at(grid, cell)).not.toBeNull();
        expect(plan.candidates.map(key)).toContain(key(plan.pick));
      }
    }
  });

  it('gives the LLM a real choice of two to four cells when nothing is certain', () => {
    const grid = distinctGrid();
    for (const level of AI_LEVELS) {
      for (const plan of plans(grid, level, 200)) {
        expect(plan.candidates.length).toBeGreaterThanOrEqual(2);
        expect(plan.candidates.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('plays the single covered cell when that is all there is', () => {
    const grid = [[null, 0.4], [null, null]];
    for (const level of AI_LEVELS) {
      const plan = planMove(grid, level, createRng(9))!;
      expect(plan.pick).toEqual({ row: 0, col: 1 });
      expect(plan.candidates).toEqual([{ row: 0, col: 1 }]);
      expect(plan.mistake).toBe(false);
    }
  });

  it('on hard, never picks a below-top cell except as a deliberate mistake', () => {
    const rng = createRng(11);
    let mistakes = 0;
    for (let i = 0; i < 1000; i++) {
      const grid = randomGrid(rng);
      const plan = planMove(grid, 'hard', rng);
      if (!plan) continue;
      if (plan.mistake) mistakes++;
      else expect(at(grid, plan.pick)).toBe(bestOf(grid));
    }
    expect(mistakes).toBeGreaterThan(0);
  });

  it('on hard, a certain mine is always taken and is all the LLM is offered', () => {
    const grid = distinctGrid();
    grid[4]![2] = 1;
    for (const plan of plans(grid, 'hard', 500)) {
      if (plan.mistake) continue;
      expect(plan.pick).toEqual({ row: 4, col: 2 });
      expect(plan.candidates).toEqual([{ row: 4, col: 2 }]);
    }

    // With several certain mines the LLM may choose among them — and only them.
    grid[0]![5] = 1;
    grid[5]![5] = 1;
    for (const plan of plans(grid, 'hard', 500)) {
      if (plan.mistake) continue;
      expect(at(grid, plan.pick)).toBe(1);
      for (const cell of plan.candidates) expect(at(grid, cell)).toBe(1);
    }
  });

  it('on medium, takes the best cell on every good move', () => {
    const grid = distinctGrid();
    for (const plan of plans(grid, 'medium', 500)) {
      if (!plan.mistake) expect(plan.pick).toEqual({ row: 0, col: 0 });
    }
  });

  it('on easy, even good moves choose among the top five', () => {
    const grid = distinctGrid();
    const ranks = new Set<number>();
    for (const plan of plans(grid, 'easy', 1000)) {
      if (plan.mistake) continue;
      const rank = plan.pick.row * 6 + plan.pick.col;
      expect(rank).toBeLessThan(5);
      ranks.add(rank);
    }
    expect(ranks.size).toBe(5);
  });

  it('draws a mistake only from cells below the top probability', () => {
    const rng = createRng(21);
    for (let i = 0; i < 500; i++) {
      const grid = randomGrid(rng);
      for (const level of AI_LEVELS) {
        const plan = planMove(grid, level, rng);
        if (!plan?.mistake) continue;
        for (const cell of plan.candidates) expect(at(grid, cell)!).toBeLessThan(bestOf(grid));
      }
    }
  });

  it('cannot make a mistake when every covered cell is equally likely', () => {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 11 / 36));
    for (const level of AI_LEVELS) {
      for (const plan of plans(grid, level, 300)) expect(plan.mistake).toBe(false);
    }
  });

  it.each([
    ['easy', 0.5, 0.05],
    ['medium', 0.2, 0.04],
    ['hard', 0.03, 0.015],
  ] as const)('makes mistakes at about the %s rate', (level, rate, tolerance) => {
    const made = plans(distinctGrid(), level, 2000, 77).filter((plan) => plan.mistake).length;
    expect(made / 2000).toBeGreaterThan(rate - tolerance);
    expect(made / 2000).toBeLessThan(rate + tolerance);
  });

  it('breaks ties at random, so an even board does not always get the same cell', () => {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0.3));
    const picks = new Set<string>();
    for (let seed = 0; seed < 50; seed++) picks.add(key(planMove(grid, 'hard', createRng(seed))!.pick));
    expect(picks.size).toBeGreaterThan(10);
  });

  it('is reproducible from the same seed', () => {
    const grid = randomGrid(createRng(5));
    for (const level of AI_LEVELS) {
      expect(planMove(grid, level, createRng(8))).toEqual(planMove(grid, level, createRng(8)));
    }
  });
});

describe('thinkDelayMs', () => {
  it.each([
    ['easy', 2200, 3800],
    ['medium', 1400, 2600],
    ['hard', 700, 1500],
  ] as const)('keeps %s between %i and %i ms and varies inside that range', (level, lo, hi) => {
    const rng = createRng(4);
    const delays = Array.from({ length: 500 }, () => thinkDelayMs(level, rng));
    for (const ms of delays) {
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(lo);
      expect(ms).toBeLessThanOrEqual(hi);
    }
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan((hi - lo) / 2);
  });
});

describe('hintFor', () => {
  it('is null when nothing is covered', () => {
    expect(hintFor([[null, null]])).toBeNull();
    expect(hintFor([])).toBeNull();
  });

  it('names the covered cell most likely to be a mine', () => {
    expect(hintFor([[null, 0.2], [0.7, 0.4]])).toEqual({ row: 1, col: 0, probability: 0.7 });
  });

  it('takes the first in reading order on a tie', () => {
    expect(hintFor([[0.1, 0.5], [0.5, null]])).toEqual({ row: 0, col: 1, probability: 0.5 });
  });
});

describe('describeHint', () => {
  // cellLabel: column letter, then row number — row 3, col 2 is "C4".
  const c4 = { row: 3, col: 2 };

  it('calls a certain mine certain', () => {
    expect(describeHint({ ...c4, probability: 1 })).toBe(
      'C4 must be a mine — the numbers around it leave no other way.',
    );
  });

  it('calls a likely mine the best bet, with a rounded percentage', () => {
    expect(describeHint({ ...c4, probability: 0.7271 })).toBe('C4 is your best bet: about 73% likely to be a mine.');
    expect(describeHint({ ...c4, probability: 0.5 })).toBe('C4 is your best bet: about 50% likely to be a mine.');
  });

  it('never rounds an uncertain cell up to 100%', () => {
    expect(describeHint({ ...c4, probability: 0.998 })).toBe('C4 is your best bet: about 99% likely to be a mine.');
  });

  it('admits when no cell is better than a coin flip', () => {
    expect(describeHint({ ...c4, probability: 0.3149 })).toBe('No sure mine left. C4 is the likeliest, at about 31%.');
  });
});

describe('level helpers', () => {
  it('labels cells the way the board rulers do', () => {
    expect(cellLabel({ row: 0, col: 0 })).toBe('A1');
    expect(cellLabel({ row: 3, col: 2 })).toBe('C4');
    expect(cellLabel({ row: 15, col: 15 })).toBe('P16');
  });

  it('accepts only the three levels', () => {
    for (const level of AI_LEVELS) expect(isAiLevel(level)).toBe(true);
    for (const value of ['Hard', 'expert', '', null, 2, undefined]) expect(isAiLevel(value)).toBe(false);
  });
});
