import { describe, expect, it } from 'vitest';
import { BOMB_COUNT, GRID_COLS, GRID_ROWS } from '../config.js';
import {
  allBombsFound,
  countNeighbourBombs,
  countRevealedBombs,
  createBoard,
  type Board,
} from './board.js';
import { revealCell } from './game.js';
import { createRng } from './rng.js';

/** Build a board from an ASCII map. '*' is a bomb, '.' is empty. */
function boardFromMap(rows: string[]): Board {
  const bombs = rows.map((line) => [...line].map((ch) => ch === '*'));
  const board: Board = {
    rows: rows.length,
    cols: rows[0]!.length,
    bombCount: bombs.flat().filter(Boolean).length,
    bombs,
    revealed: rows.map((line) => [...line].map(() => false)),
    adjacent: rows.map((line) => [...line].map(() => 0)),
  };
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      board.adjacent[r]![c] = countNeighbourBombs(board, r, c);
    }
  }
  return board;
}

describe('createBoard', () => {
  it('uses the assignment defaults: 6x6 with exactly 11 bombs', () => {
    const board = createBoard();
    expect(board.rows).toBe(GRID_ROWS);
    expect(board.cols).toBe(GRID_COLS);
    expect(board.bombs.flat().filter(Boolean)).toHaveLength(BOMB_COUNT);
  });

  it('places exactly bombCount bombs across many random seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const board = createBoard({ rows: 6, cols: 6, bombCount: 11 }, createRng(seed));
      expect(board.bombs.flat().filter(Boolean)).toHaveLength(11);
    }
  });

  it('produces different layouts for different seeds', () => {
    const a = createBoard(undefined, createRng(1)).bombs.flat().join('');
    const b = createBoard(undefined, createRng(2)).bombs.flat().join('');
    expect(a).not.toBe(b);
  });

  it('starts with every slot covered', () => {
    const board = createBoard();
    expect(board.revealed.flat().some(Boolean)).toBe(false);
  });

  it('handles the degenerate case of an entirely mined board', () => {
    const board = createBoard({ rows: 3, cols: 3, bombCount: 9 }, createRng(7));
    expect(board.bombs.flat().every(Boolean)).toBe(true);
  });

  it('rejects more bombs than there are slots', () => {
    expect(() => createBoard({ rows: 2, cols: 2, bombCount: 5 })).toThrow();
  });
});

describe('countNeighbourBombs', () => {
  //  * . .
  //  . * .
  //  . . *
  const diagonal = boardFromMap(['*..', '.*.', '..*']);

  it('counts all 8 surrounding slots including diagonals', () => {
    // Centre (1,1) is itself a bomb; its 8 neighbours contain (0,0) and (2,2).
    expect(diagonal.adjacent[1]![1]).toBe(2);
  });

  it('does not count the cell itself', () => {
    // (0,0) is a bomb. Only (1,1) neighbours it.
    expect(diagonal.adjacent[0]![0]).toBe(1);
  });

  it('clamps correctly at corners', () => {
    expect(diagonal.adjacent[0]![2]).toBe(1); // top-right touches (1,1) only
  });

  it('clamps correctly at edges', () => {
    expect(diagonal.adjacent[0]![1]).toBe(2); // touches (0,0) and (1,1)
  });

  it('reports 0 where no bomb is adjacent', () => {
    const sparse = boardFromMap(['*....', '.....', '.....']);
    expect(sparse.adjacent[2]![4]).toBe(0);
  });

  it('reports the maximum of 8 when fully surrounded', () => {
    const surrounded = boardFromMap(['***', '*.*', '***']);
    expect(surrounded.adjacent[1]![1]).toBe(8);
  });
});

describe('revealCell', () => {
  it('awards a point and keeps the turn when a bomb is found', () => {
    const board = boardFromMap(['*.', '..']);
    const outcome = revealCell(board, 0, 0);
    expect(outcome).toMatchObject({
      ok: true,
      kind: 'bomb',
      pointsAwarded: 1,
      keepsTurn: true,
    });
  });

  it('awards nothing and passes the turn on an empty slot', () => {
    const board = boardFromMap(['*.', '..']);
    const outcome = revealCell(board, 1, 1);
    expect(outcome).toMatchObject({
      ok: true,
      kind: 'empty',
      pointsAwarded: 0,
      keepsTurn: false,
    });
  });

  it('returns the adjacent bomb count for an empty slot', () => {
    const board = boardFromMap(['**.', '...', '...']);
    const outcome = revealCell(board, 1, 1);
    expect(outcome.ok && outcome.adjacent).toBe(2);
  });

  it('rejects a slot that is already revealed, so cells stay disabled', () => {
    const board = boardFromMap(['*.', '..']);
    expect(revealCell(board, 0, 0).ok).toBe(true);
    expect(revealCell(board, 0, 0)).toEqual({ ok: false, reason: 'already-revealed' });
  });

  it('rejects coordinates outside the grid', () => {
    const board = boardFromMap(['*.', '..']);
    expect(revealCell(board, -1, 0)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(revealCell(board, 0, 99)).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('signals completion only once the final bomb is uncovered', () => {
    const board = boardFromMap(['*.', '.*']);
    const first = revealCell(board, 0, 0);
    expect(first.ok && first.matchComplete).toBe(false);

    const second = revealCell(board, 1, 1);
    expect(second.ok && second.matchComplete).toBe(true);
    expect(allBombsFound(board)).toBe(true);
  });

  it('does not end the match when only empty slots remain covered', () => {
    const board = boardFromMap(['*.', '..']);
    revealCell(board, 0, 0);
    expect(allBombsFound(board)).toBe(true); // the single bomb was the only one
  });

  it('tracks revealed bomb count independently of revealed empties', () => {
    const board = boardFromMap(['*.', '.*']);
    revealCell(board, 0, 1); // empty
    revealCell(board, 1, 0); // empty
    expect(countRevealedBombs(board)).toBe(0);
    revealCell(board, 0, 0); // bomb
    expect(countRevealedBombs(board)).toBe(1);
  });
});

describe('full 6x6 playthrough', () => {
  it('uncovering every slot finds exactly 11 bombs and ends the match', () => {
    const board = createBoard(undefined, createRng(42));
    let points = 0;
    let completedAt = -1;
    let moves = 0;

    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const outcome = revealCell(board, r, c);
        moves++;
        if (!outcome.ok) throw new Error('unexpected rejection');
        points += outcome.pointsAwarded;
        if (outcome.matchComplete && completedAt === -1) completedAt = moves;
      }
    }

    expect(points).toBe(BOMB_COUNT);
    expect(completedAt).toBeGreaterThan(0);
    expect(completedAt).toBeLessThanOrEqual(36);
  });
});
