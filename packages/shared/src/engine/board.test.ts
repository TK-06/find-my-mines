import { describe, expect, it } from 'vitest';
import { createBoard, inBounds } from './board.js';
import { revealCell } from './game.js';
import { createRng } from './rng.js';

const SIX = { rows: 6, cols: 6 };

describe('inBounds', () => {
  it('accepts every whole-number cell on the grid, corners included', () => {
    expect(inBounds(SIX, 0, 0)).toBe(true);
    expect(inBounds(SIX, 5, 5)).toBe(true);
    expect(inBounds(SIX, 0, 5)).toBe(true);
    expect(inBounds(SIX, 3, 2)).toBe(true);
  });

  it('rejects negative coordinates', () => {
    expect(inBounds(SIX, -1, 0)).toBe(false);
    expect(inBounds(SIX, 0, -1)).toBe(false);
  });

  it('rejects coordinates past the last row or column', () => {
    expect(inBounds(SIX, 6, 0)).toBe(false);
    expect(inBounds(SIX, 0, 6)).toBe(false);
    expect(inBounds(SIX, 99, 99)).toBe(false);
  });

  // A reveal arrives as JSON from any client, so a row like 2.5 is possible.
  // It sits between two real rows, so a plain range check lets it through.
  it('rejects fractional coordinates', () => {
    expect(inBounds(SIX, 2.5, 0)).toBe(false);
    expect(inBounds(SIX, 0, 0.1)).toBe(false);
    expect(inBounds(SIX, 5.999, 5)).toBe(false);
  });

  // Number(undefined) and Number('a') are NaN; every comparison with NaN is
  // false, which happens to reject it today — pinned so it stays that way.
  it('rejects NaN', () => {
    expect(inBounds(SIX, Number.NaN, 0)).toBe(false);
    expect(inBounds(SIX, 0, Number.NaN)).toBe(false);
  });

  it('rejects infinities', () => {
    expect(inBounds(SIX, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(inBounds(SIX, 0, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe('revealCell with a fractional coordinate', () => {
  it('is refused as out of bounds instead of throwing, and uncovers nothing', () => {
    const board = createBoard({ rows: 6, cols: 6, bombCount: 11 }, createRng(7));
    expect(revealCell(board, 2.5, 1)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(revealCell(board, 1, 0.5)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(board.revealed.flat().some(Boolean)).toBe(false);
  });
});
