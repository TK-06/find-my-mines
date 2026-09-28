import { describe, expect, it } from 'vitest';
import { createBoard } from './board.js';
import { createRng, randomInt } from './rng.js';
import { mineProbabilities, type SolverCell, type SolverView } from './solver.js';

/**
 * A view from an ASCII map: '.' is covered, '*' is a found mine, a digit is a
 * revealed empty cell showing that many adjacent mines.
 */
function viewFromMap(map: string[], mineCount: number): SolverView {
  const revealed: SolverCell[] = [];
  map.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch === '*') revealed.push({ row, col, kind: 'bomb', adjacent: 0 });
      else if (ch !== '.') revealed.push({ row, col, kind: 'empty', adjacent: Number(ch) });
    }),
  );
  return { rows: map.length, cols: map[0]!.length, mineCount, revealed };
}

function solve(map: string[], mineCount: number) {
  return mineProbabilities(viewFromMap(map, mineCount));
}

/** Every covered cell's probability, row-major, for checks over the whole board. */
function coveredValues(grid: (number | null)[][]): number[] {
  return grid.flat().filter((p): p is number => p !== null);
}

/**
 * The exact answer by brute force: try every way to put the remaining mines
 * under the covered cells, keep the layouts every revealed number agrees with,
 * and count how often each cell holds a mine. Only for tiny boards.
 */
function bruteForce(view: SolverView): (number | null)[][] {
  const open = new Map(view.revealed.map((c) => [`${c.row}:${c.col}`, c]));
  const covered: [number, number][] = [];
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) if (!open.has(`${r}:${c}`)) covered.push([r, c]);
  }
  const remaining = view.mineCount - view.revealed.filter((c) => c.kind === 'bomb').length;
  const hits = covered.map(() => 0);
  let layouts = 0;

  const isMine = (mines: Set<number>, r: number, c: number): boolean => {
    const cell = open.get(`${r}:${c}`);
    if (cell) return cell.kind === 'bomb';
    return mines.has(covered.findIndex(([cr, cc]) => cr === r && cc === c));
  };
  const consistent = (mines: Set<number>): boolean =>
    view.revealed.every((cell) => {
      if (cell.kind !== 'empty') return true;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = cell.row + dr;
          const c = cell.col + dc;
          if ((dr || dc) && r >= 0 && r < view.rows && c >= 0 && c < view.cols && isMine(mines, r, c)) count++;
        }
      }
      return count === cell.adjacent;
    });

  const choose = (start: number, left: number, mines: Set<number>): void => {
    if (left === 0) {
      if (!consistent(mines)) return;
      layouts++;
      mines.forEach((i) => hits[i]!++);
      return;
    }
    for (let i = start; i <= covered.length - left; i++) {
      mines.add(i);
      choose(i + 1, left - 1, mines);
      mines.delete(i);
    }
  };
  choose(0, remaining, new Set());

  const grid: (number | null)[][] = Array.from({ length: view.rows }, () =>
    Array.from({ length: view.cols }, () => null),
  );
  covered.forEach(([r, c], i) => (grid[r]![c] = hits[i]! / layouts));
  return grid;
}

/** A real game in progress: a seeded board with some cells uncovered. */
function gameInProgress(
  seed: number,
  size: { rows: number; cols: number; mines: number },
  reveals: number,
): { view: SolverView; bombs: boolean[][] } {
  const rng = createRng(seed);
  const board = createBoard({ rows: size.rows, cols: size.cols, bombCount: size.mines }, rng);
  const revealed: SolverCell[] = [];
  const seen = new Set<string>();
  while (revealed.length < reveals) {
    const row = randomInt(rng, size.rows);
    const col = randomInt(rng, size.cols);
    if (seen.has(`${row}:${col}`)) continue;
    seen.add(`${row}:${col}`);
    const bomb = board.bombs[row]![col]!;
    revealed.push({ row, col, kind: bomb ? 'bomb' : 'empty', adjacent: bomb ? 0 : board.adjacent[row]![col]! });
  }
  return { view: { rows: size.rows, cols: size.cols, mineCount: size.mines, revealed }, bombs: board.bombs };
}

describe('mineProbabilities', () => {
  it('spreads the mines evenly when nothing is open yet', () => {
    const grid = solve(['......', '......', '......', '......', '......', '......'], 11);
    for (const p of grid.flat()) expect(p).toBeCloseTo(11 / 36, 12);
  });

  it('marks revealed cells null and leaves covered ones numeric', () => {
    const grid = solve(['0..', '...', '..*'], 2);
    expect(grid[0]![0]).toBeNull();
    expect(grid[2]![2]).toBeNull();
    expect(typeof grid[1]![1]).toBe('number');
    expect(grid).toHaveLength(3);
    grid.forEach((row) => expect(row).toHaveLength(3));
  });

  it('clears every covered neighbour of a 0', () => {
    const grid = solve(['0..', '...', '...'], 2);
    expect(grid[0]![1]).toBe(0);
    expect(grid[1]![0]).toBe(0);
    expect(grid[1]![1]).toBe(0);
    // The two mines sit somewhere in the five cells the 0 cannot see.
    for (const [r, c] of [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]] as const) {
      expect(grid[r]![c]).toBeCloseTo(2 / 5, 12);
    }
  });

  it('makes a 1 with exactly one covered neighbour a certain mine', () => {
    // The corner 1 sees only (1,1) covered, so that is the mine; the other two
    // 1s are then satisfied, so their remaining neighbours are safe.
    const grid = solve(['11..', '1...', '....', '....'], 3);
    expect(grid[1]![1]).toBe(1);
    for (const [r, c] of [[0, 2], [1, 2], [2, 0], [2, 1]] as const) expect(grid[r]![c]).toBe(0);
    // Two mines left for the eight cells no number touches.
    for (const [r, c] of [[0, 3], [1, 3], [2, 2], [2, 3], [3, 0], [3, 1], [3, 2], [3, 3]] as const) {
      expect(grid[r]![c]).toBeCloseTo(2 / 8, 12);
    }
  });

  it('counts a found mine against the numbers around it', () => {
    // The 1 already touches the found mine, so none of its covered neighbours can be one.
    const grid = solve(['*1..', '....', '....'], 3);
    for (const [r, c] of [[0, 2], [1, 0], [1, 1], [1, 2]] as const) expect(grid[r]![c]).toBe(0);
    for (const [r, c] of [[0, 3], [1, 3], [2, 0], [2, 1], [2, 2], [2, 3]] as const) {
      expect(grid[r]![c]).toBeCloseTo(2 / 6, 12);
    }
  });

  it('lets the total mine count decide between layouts of different sizes', () => {
    // Both 1s share (0,2): either that one cell is the mine, or (0,0) and (0,4)
    // both are. Three untouched cells ((0,5)..(0,7)) absorb the rest.
    const map = ['.1.1....'];
    const one = solve(map, 1);
    expect(one[0]![2]).toBe(1);
    expect(one[0]![0]).toBe(0);
    expect(one[0]![5]).toBe(0);

    const two = solve(map, 2);
    expect(two[0]![2]).toBeCloseTo(3 / 4, 12);
    expect(two[0]![0]).toBeCloseTo(1 / 4, 12);
    expect(two[0]![4]).toBeCloseTo(1 / 4, 12);
    expect(two[0]![6]).toBeCloseTo(1 / 4, 12);

    const three = solve(map, 3);
    expect(three[0]![2]).toBeCloseTo(1 / 2, 12);
    expect(three[0]![0]).toBeCloseTo(1 / 2, 12);
    expect(three[0]![7]).toBeCloseTo(1 / 2, 12);
  });

  it('matches brute-force enumeration on small random games', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { view } = gameInProgress(seed, { rows: 4, cols: 5, mines: 5 }, 4 + (seed % 7));
      const expected = bruteForce(view);
      const actual = mineProbabilities(view);
      actual.forEach((row, r) =>
        row.forEach((p, c) => {
          const want = expected[r]![c]!;
          if (want === null) expect(p).toBeNull();
          else expect(p).toBeCloseTo(want, 9);
        }),
      );
    }
  });

  it('never calls a real mine safe or a safe cell certain', () => {
    for (let seed = 100; seed < 160; seed++) {
      const { view, bombs } = gameInProgress(seed, { rows: 10, cols: 10, mines: 20 }, 20 + (seed % 50));
      mineProbabilities(view).forEach((row, r) =>
        row.forEach((p, c) => {
          if (p === 1) expect(bombs[r]![c]).toBe(true);
          if (p === 0) expect(bombs[r]![c]).toBe(false);
        }),
      );
    }
  });

  it('approximates a group too big to enumerate without pinning the untouched cells', () => {
    // Rows 1 and 3 are open. Their numbers link all 48 cells of rows 0, 2 and
    // 4 into one loose group; none of them is 0 or full, so nothing can be
    // settled for certain. The mines are on row 2, which both rows of numbers
    // see, so local ratios overestimate the group (~12 against a true 8) —
    // treating that estimate as a fixed count would leave no mines for the
    // three that really sit below row 4.
    const size = 16;
    const interiorMines = [[8, 3], [11, 9], [14, 14]];
    const mine = (r: number, c: number): boolean =>
      (r === 2 && c % 2 === 1) || interiorMines.some(([mr, mc]) => mr === r && mc === c);
    const revealed: SolverCell[] = [];
    for (const row of [1, 3]) {
      for (let col = 0; col < size; col++) {
        let adjacent = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if ((dr || dc) && col + dc >= 0 && col + dc < size && mine(row + dr, col + dc)) adjacent++;
          }
        }
        revealed.push({ row, col, kind: 'empty', adjacent });
      }
    }
    const started = performance.now();
    const grid = mineProbabilities({ rows: size, cols: size, mineCount: 11, revealed });
    expect(performance.now() - started).toBeLessThan(200);

    for (const row of [0, 2, 4]) {
      for (let col = 0; col < size; col++) {
        expect(grid[row]![col]).toBeGreaterThan(0);
        expect(grid[row]![col]).toBeLessThan(1);
      }
    }
    // Every cell below row 4 is untouched and must keep a real chance.
    for (const p of grid.slice(5).flat() as number[]) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('falls back to an even spread on numbers that cannot all be true', () => {
    // A 3 with a single covered neighbour is impossible.
    const view = viewFromMap(['3.', '00'], 1);
    let grid: (number | null)[][] = [];
    expect(() => (grid = mineProbabilities(view))).not.toThrow();
    expect(grid[0]![1]).toBe(1);

    const contradictory = solve(['0*..', '....'], 3);
    const values = coveredValues(contradictory);
    expect(values).toHaveLength(6);
    for (const p of values) expect(p).toBeCloseTo(2 / 6, 12);
  });

  it('stays within [0, 1] when more mines were found than the board claims', () => {
    const grid = solve(['**..', '....'], 1);
    for (const p of coveredValues(grid)) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('ignores cells outside the board instead of throwing', () => {
    const view: SolverView = {
      rows: 2,
      cols: 2,
      mineCount: 1,
      revealed: [{ row: 5, col: -1, kind: 'empty', adjacent: 3 }],
    };
    expect(coveredValues(mineProbabilities(view))).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('keeps probabilities in [0, 1] on a busy 16x16 board and finishes well under 200 ms', () => {
    let slowest = 0;
    for (let seed = 7; seed < 17; seed++) {
      const { view } = gameInProgress(seed, { rows: 16, cols: 16, mines: 60 }, 60 + seed * 8);
      const started = performance.now();
      const grid = mineProbabilities(view);
      slowest = Math.max(slowest, performance.now() - started);
      for (const p of coveredValues(grid)) {
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
    expect(slowest).toBeLessThan(200);
  });
});
