import { describe, expect, it } from 'vitest';
import { indexAt, MIN_CELL_PX, moveInView, shouldTranspose, viewOf, viewSize } from './boardView.js';

// Hard: 16 rows by 30 columns.
const ROWS = 16;
const COLS = 30;

describe('shouldTranspose', () => {
  it('turns Hard upright on a phone', () => {
    expect(shouldTranspose(ROWS, COLS, 318)).toBe(true);
  });

  it('leaves Hard as it is where 30 columns fit', () => {
    expect(shouldTranspose(ROWS, COLS, COLS * MIN_CELL_PX + 24)).toBe(false);
    expect(shouldTranspose(ROWS, COLS, 900)).toBe(false);
  });

  it('never turns a square or tall board', () => {
    expect(shouldTranspose(16, 16, 200)).toBe(false);
    expect(shouldTranspose(9, 9, 100)).toBe(false);
  });

  it('does nothing before the width is known', () => {
    expect(shouldTranspose(ROWS, COLS, 0)).toBe(false);
  });
});

describe('viewSize', () => {
  it('swaps rows and columns when upright', () => {
    expect(viewSize(ROWS, COLS, true)).toEqual({ viewRows: 30, viewCols: 16 });
    expect(viewSize(ROWS, COLS, false)).toEqual({ viewRows: 16, viewCols: 30 });
  });
});

describe('indexAt and viewOf', () => {
  it('are each other’s inverse, both ways round', () => {
    for (const transposed of [false, true]) {
      for (let index = 0; index < ROWS * COLS; index += 37) {
        const { viewRow, viewCol } = viewOf(index, COLS, transposed);
        expect(indexAt(viewRow, viewCol, COLS, transposed)).toBe(index);
      }
    }
  });

  it('draws game row r, column c at screen row c, column r when upright', () => {
    // Game row 2, column 5.
    const index = 2 * COLS + 5;
    expect(viewOf(index, COLS, true)).toEqual({ viewRow: 5, viewCol: 2 });
    expect(viewOf(index, COLS, false)).toEqual({ viewRow: 2, viewCol: 5 });
  });
});

describe('moveInView', () => {
  const start = 2 * COLS + 5; // game row 2, column 5

  it('moves through game rows and columns on a normal board', () => {
    expect(moveInView(start, 'ArrowDown', ROWS, COLS, false)).toBe(3 * COLS + 5);
    expect(moveInView(start, 'ArrowRight', ROWS, COLS, false)).toBe(2 * COLS + 6);
  });

  it('follows the screen on an upright board', () => {
    // Down on screen is the next game column; right on screen is the next game row.
    expect(moveInView(start, 'ArrowDown', ROWS, COLS, true)).toBe(2 * COLS + 6);
    expect(moveInView(start, 'ArrowRight', ROWS, COLS, true)).toBe(3 * COLS + 5);
    expect(moveInView(start, 'ArrowUp', ROWS, COLS, true)).toBe(2 * COLS + 4);
    expect(moveInView(start, 'ArrowLeft', ROWS, COLS, true)).toBe(1 * COLS + 5);
  });

  it('stops at the edges', () => {
    expect(moveInView(0, 'ArrowUp', ROWS, COLS, true)).toBe(0);
    expect(moveInView(0, 'ArrowLeft', ROWS, COLS, true)).toBe(0);
    const last = ROWS * COLS - 1;
    expect(moveInView(last, 'ArrowDown', ROWS, COLS, true)).toBe(last);
    expect(moveInView(last, 'ArrowRight', ROWS, COLS, false)).toBe(last);
  });

  it('goes to the ends of the screen row, or the board with Ctrl', () => {
    // Upright: screen row 5 holds game column 5 of every game row.
    expect(moveInView(start, 'Home', ROWS, COLS, true)).toBe(0 * COLS + 5);
    expect(moveInView(start, 'End', ROWS, COLS, true)).toBe(15 * COLS + 5);
    expect(moveInView(start, 'Home', ROWS, COLS, true, true)).toBe(0);
    expect(moveInView(start, 'End', ROWS, COLS, true, true)).toBe(ROWS * COLS - 1);
    expect(moveInView(start, 'Home', ROWS, COLS, false)).toBe(2 * COLS);
  });

  it('ignores other keys', () => {
    expect(moveInView(start, 'Enter', ROWS, COLS, true)).toBeNull();
    expect(moveInView(start, 'f', ROWS, COLS, false)).toBeNull();
  });
});
