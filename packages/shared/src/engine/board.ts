import { BOMB_COUNT, GRID_COLS, GRID_ROWS } from '../config.js';
import { createRng, randomInt, type Rng } from './rng.js';

export interface BoardConfig {
  rows: number;
  cols: number;
  bombCount: number;
}

/**
 * The authoritative board. This object lives ONLY on the server —
 * `bombs` is never serialised to a client.
 */
export interface Board {
  rows: number;
  cols: number;
  bombCount: number;
  bombs: boolean[][];
  revealed: boolean[][];
  /** Precomputed count of bombs in the 8 surrounding slots. */
  adjacent: number[][];
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  rows: GRID_ROWS,
  cols: GRID_COLS,
  bombCount: BOMB_COUNT,
};

/** The 8 surrounding slots, including diagonals. */
const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], /*     */ [0, 1],
  [1, -1], [1, 0], [1, 1],
];

function grid<T>(rows: number, cols: number, fill: T): T[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

/**
 * True for a real cell of the grid. Coordinates come straight off the wire, so
 * a row like 2.5 is possible: it passes a plain range check yet names no row,
 * and indexing the grid with it throws. Whole numbers only (which also rules
 * out NaN and the infinities).
 */
export function inBounds(board: Pick<Board, 'rows' | 'cols'>, row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < board.rows &&
    col >= 0 &&
    col < board.cols
  );
}

/**
 * Places exactly `bombCount` bombs at distinct random positions, then
 * precomputes every cell's adjacent-bomb count.
 */
export function createBoard(
  config: BoardConfig = DEFAULT_BOARD_CONFIG,
  rng: Rng = createRng(),
): Board {
  const { rows, cols, bombCount } = config;
  const total = rows * cols;

  if (bombCount > total) {
    throw new Error(`Cannot place ${bombCount} bombs on a ${rows}x${cols} board`);
  }

  const bombs = grid(rows, cols, false);

  // Partial Fisher-Yates over flat indices guarantees distinct positions
  // without a retry loop, so bomb count is exact by construction.
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = 0; i < bombCount; i++) {
    const j = i + randomInt(rng, total - i);
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    const flat = indices[i]!;
    bombs[Math.floor(flat / cols)]![flat % cols] = true;
  }

  const board: Board = {
    rows,
    cols,
    bombCount,
    bombs,
    revealed: grid(rows, cols, false),
    adjacent: grid(rows, cols, 0),
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      board.adjacent[r]![c] = countNeighbourBombs(board, r, c);
    }
  }

  return board;
}

/** Bombs in the 8 slots surrounding (row, col). The cell itself is not counted. */
export function countNeighbourBombs(board: Board, row: number, col: number): number {
  let count = 0;
  for (const [dr, dc] of NEIGHBOUR_OFFSETS) {
    const r = row + dr;
    const c = col + dc;
    if (inBounds(board, r, c) && board.bombs[r]![c]) count++;
  }
  return count;
}

export function isBomb(board: Board, row: number, col: number): boolean {
  return board.bombs[row]![col]!;
}

export function isRevealed(board: Board, row: number, col: number): boolean {
  return board.revealed[row]![col]!;
}

export function countRevealedBombs(board: Board): number {
  let found = 0;
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      if (board.revealed[r]![c] && board.bombs[r]![c]) found++;
    }
  }
  return found;
}

/** Spec: "The match ends when all bombs have been found." */
export function allBombsFound(board: Board): boolean {
  return countRevealedBombs(board) === board.bombCount;
}
