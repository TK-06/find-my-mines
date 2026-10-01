import { describe, expect, it } from 'vitest';
import { createBoard, createRng, revealCell, type CellRef, type RevealedCell, type SolverView } from '@fmm/shared';
import { FLY_FEATURES, flyCandidatesAll, flyFeatures } from './features.js';

const empty = (row: number, col: number, adjacent: number): RevealedCell => ({
  row,
  col,
  kind: 'empty',
  adjacent,
  byPlayerId: 'p',
});
const mine = (row: number, col: number): RevealedCell => ({ row, col, kind: 'bomb', adjacent: 0, byPlayerId: 'p' });

const view = (revealed: RevealedCell[], size = 6, mineCount = 11): SolverView => ({
  rows: size,
  cols: size,
  mineCount,
  revealed,
});

/** The feature vector as a record, so a test reads by name rather than by position. */
function named(values: number[]): Record<string, number> {
  return Object.fromEntries(FLY_FEATURES.map((name, i) => [name, values[i]!]));
}

const of = (v: SolverView, cell: CellRef) => named(flyFeatures(v, [cell])[0]!);

describe('flyFeatures', () => {
  it('has the eight named features, in order', () => {
    expect([...FLY_FEATURES]).toEqual([
      'open neighbours',
      'numbers nearby',
      'mines found nearby',
      'at the edge',
      'mines left',
      'pressure max',
      'pressure mean',
      'pressure min',
    ]);
  });

  it('describes each candidate with one value per named feature', () => {
    const rows = flyFeatures(view([]), [
      { row: 0, col: 0 },
      { row: 2, col: 3 },
    ]);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveLength(FLY_FEATURES.length);
  });

  it('on a board with nothing open, tells a corner, an edge and the middle apart and nothing else', () => {
    const v = view([]);
    const corner = of(v, { row: 0, col: 0 });
    const edge = of(v, { row: 0, col: 3 });
    const middle = of(v, { row: 2, col: 3 });
    expect(corner['at the edge']).toBeCloseTo(1 - 3 / 8);
    expect(edge['at the edge']).toBeCloseTo(1 - 5 / 8);
    expect(middle['at the edge']).toBe(0);
    for (const cell of [corner, edge, middle]) {
      expect(cell['open neighbours']).toBe(0);
      expect(cell['numbers nearby']).toBe(0);
      expect(cell['mines found nearby']).toBe(0);
      expect(cell['mines left']).toBeCloseTo(11 / 36);
      expect(cell['pressure max']).toBe(0);
      expect(cell['pressure mean']).toBe(0);
      expect(cell['pressure min']).toBe(0);
    }
  });

  it('reads the open cells around a candidate', () => {
    // Around (2,2): two open numbers (2 and 4) and one found mine.
    const v = view([empty(1, 1, 2), empty(1, 2, 4), mine(3, 3)]);
    const cell = of(v, { row: 2, col: 2 });
    expect(cell['open neighbours']).toBeCloseTo(3 / 8);
    expect(cell['numbers nearby']).toBeCloseTo(3 / 8); // mean of 2 and 4, out of 8
    expect(cell['mines found nearby']).toBeCloseTo(1 / 8);
    expect(cell['at the edge']).toBe(0);
    // 10 mines still hidden among 33 covered cells.
    expect(cell['mines left']).toBeCloseTo(10 / 33);
  });

  it('works out each numbered neighbour’s pressure: mines still needed per covered cell around it', () => {
    // (1,1) says 2 and has 7 covered cells around it (only (1,2) is open): 2/7.
    // (1,2) says 4 with 7 covered around it ((1,1) is open): 4/7. No mine is found next to either.
    const v = view([empty(1, 1, 2), empty(1, 2, 4), mine(3, 3)]);
    const cell = of(v, { row: 2, col: 2 });
    expect(cell['pressure max']).toBeCloseTo(4 / 7);
    expect(cell['pressure mean']).toBeCloseTo(3 / 7);
    expect(cell['pressure min']).toBeCloseTo(2 / 7);
  });

  it('takes found mines off a number before dividing', () => {
    // (1,1) says 3, one of them is the found mine at (1,2); 2 still needed over 7 covered cells.
    const v = view([empty(1, 1, 3), mine(1, 2)]);
    const cell = of(v, { row: 0, col: 0 });
    expect(cell['open neighbours']).toBeCloseTo(1 / 3);
    expect(cell['numbers nearby']).toBeCloseTo(3 / 8);
    expect(cell['mines found nearby']).toBe(0);
    expect(cell['pressure max']).toBeCloseTo(2 / 7);
    expect(cell['pressure min']).toBeCloseTo(2 / 7);
  });

  it('has no pressure from a number whose mines are all found', () => {
    const v = view([empty(1, 1, 1), mine(0, 0)]);
    const cell = of(v, { row: 2, col: 2 });
    expect(cell['numbers nearby']).toBeCloseTo(1 / 8);
    expect(cell['mines found nearby']).toBe(0);
    expect([cell['pressure max'], cell['pressure mean'], cell['pressure min']]).toEqual([0, 0, 0]);
  });

  it('keeps pressure at 1 at most when a number says more than there is room for', () => {
    // (0,0) is a corner with 3 neighbours; saying 5 is impossible but must not leave 0–1.
    const cell = of(view([empty(0, 0, 5)]), { row: 0, col: 1 });
    expect(cell['pressure max']).toBe(1);
  });

  it('reads a corner candidate beside an open number', () => {
    const cell = of(view([empty(4, 4, 1)]), { row: 5, col: 5 });
    expect(cell['at the edge']).toBeCloseTo(1 - 3 / 8);
    expect(cell['open neighbours']).toBeCloseTo(1 / 3);
    expect(cell['pressure max']).toBeCloseTo(1 / 8);
    expect(cell['pressure mean']).toBeCloseTo(1 / 8);
    expect(cell['pressure min']).toBeCloseTo(1 / 8);
  });

  it('counts a found mine as open but not as a number, with no pressure from it', () => {
    const cell = of(view([mine(0, 1), mine(1, 0)]), { row: 0, col: 0 });
    expect(cell['open neighbours']).toBeCloseTo(2 / 3);
    expect(cell['mines found nearby']).toBeCloseTo(2 / 3);
    expect(cell['numbers nearby']).toBe(0);
    expect(cell['pressure max']).toBe(0);
    // 9 mines hidden among 34 covered cells.
    expect(cell['mines left']).toBeCloseTo(9 / 34);
  });

  it('keeps every value between 0 and 1 on real mid-game boards', () => {
    const rng = createRng(12);
    for (let game = 0; game < 40; game++) {
      const board = createBoard({ rows: 6, cols: 6, bombCount: 11 }, rng);
      const revealed: RevealedCell[] = [];
      const steps = Math.floor(rng() * 30);
      for (let i = 0; i < steps; i++) {
        const row = Math.floor(rng() * 6);
        const col = Math.floor(rng() * 6);
        const outcome = revealCell(board, row, col);
        if (outcome.ok) revealed.push({ row, col, kind: outcome.kind, adjacent: outcome.adjacent, byPlayerId: 'p' });
      }
      const v = view(revealed);
      const open = new Set(revealed.map((c) => `${c.row}:${c.col}`));
      const covered = flyCandidatesAll(v, rng).filter((c) => !open.has(`${c.row}:${c.col}`));
      for (const values of flyFeatures(v, covered)) {
        for (const value of values) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('ignores open cells that are off the board', () => {
    const cell = of(view([empty(-1, 0, 8), empty(0, 6, 8)]), { row: 0, col: 0 });
    expect(cell['open neighbours']).toBe(0);
    expect(cell['numbers nearby']).toBe(0);
    expect(cell['pressure max']).toBe(0);
  });
});

describe('flyCandidatesAll', () => {
  const key = (cell: CellRef) => `${cell.row}:${cell.col}`;
  /** An open 5×5 block in the corner of a 16×16 board: 11 covered cells touch it, 220 do not. */
  const block = (): RevealedCell[] =>
    Array.from({ length: 25 }, (_, i) => empty(Math.floor(i / 5), i % 5, 0));

  it('offers every covered cell, in board order, when there are no more than the cap', () => {
    const v = view([empty(0, 0, 1), mine(5, 5)]);
    const cells = flyCandidatesAll(v, createRng(1));
    expect(cells).toHaveLength(34);
    expect(cells.map(key)).not.toContain('0:0');
    expect(cells.map(key)).not.toContain('5:5');
    expect(cells[0]).toEqual({ row: 0, col: 1 });
    expect(flyCandidatesAll(view([]), createRng(1))).toHaveLength(36);
  });

  it('on a big untouched board takes a random sample up to the cap, the same for the same seed', () => {
    const v = view([], 16, 51);
    const a = flyCandidatesAll(v, createRng(7));
    expect(a).toHaveLength(40);
    expect(new Set(a.map(key)).size).toBe(40);
    expect(flyCandidatesAll(v, createRng(7))).toEqual(a);
    expect(flyCandidatesAll(v, createRng(8)).map(key)).not.toEqual(a.map(key));
  });

  it('keeps every covered cell that touches an open cell, then samples the rest up to the cap', () => {
    const v = view(block(), 16, 51);
    const cells = flyCandidatesAll(v, createRng(3));
    expect(cells).toHaveLength(40);
    expect(new Set(cells.map(key)).size).toBe(40);
    const open = new Set(block().map(key));
    for (const cell of cells) expect(open.has(key(cell))).toBe(false);
    // The 11 cells around the block (row 5 cols 0–5, col 5 rows 0–4) are all there.
    const frontier = [...Array.from({ length: 6 }, (_, c) => ({ row: 5, col: c })), ...Array.from({ length: 5 }, (_, r) => ({ row: r, col: 5 }))];
    for (const cell of frontier) expect(cells.map(key)).toContain(key(cell));
    expect(cells.slice(0, 11).map(key).sort()).toEqual(frontier.map(key).sort());
    expect(flyCandidatesAll(v, createRng(3))).toEqual(cells);
  });

  it('never drops a frontier cell, even when the frontier is bigger than the cap', () => {
    const cells = flyCandidatesAll(view(block(), 16, 51), createRng(3), 5);
    expect(cells).toHaveLength(11);
  });

  it('is empty when nothing is covered', () => {
    const all = Array.from({ length: 36 }, (_, i) => empty(Math.floor(i / 6), i % 6, 0));
    expect(flyCandidatesAll(view(all), createRng(1))).toEqual([]);
  });
});
