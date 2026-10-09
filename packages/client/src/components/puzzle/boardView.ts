/**
 * How the puzzle board is drawn on screen. A board wider than it is tall (Hard,
 * 30 × 16) does not fit a phone at any size a finger can hit, so there it is
 * drawn turned upright: game row r, column c sits at screen row c, column r.
 * Only the drawing changes — every cell keeps its game index, so play, flags,
 * hints and best times never know.
 */

/** The smallest cell, in CSS pixels, that a board is allowed to shrink to before it turns upright. */
export const MIN_CELL_PX = 20;
/** The row-number ruler plus its gap: what a board needs besides its cells. */
const RULER_PX = 24;

/**
 * Turn the board upright when it is wider than tall and its columns would be
 * smaller than `MIN_CELL_PX` in the space it has.
 */
export function shouldTranspose(rows: number, cols: number, availableWidth: number): boolean {
  if (cols <= rows || availableWidth <= 0) return false;
  return availableWidth < cols * MIN_CELL_PX + RULER_PX;
}

/** The screen's rows and columns. */
export function viewSize(rows: number, cols: number, transposed: boolean): { viewRows: number; viewCols: number } {
  return transposed ? { viewRows: cols, viewCols: rows } : { viewRows: rows, viewCols: cols };
}

/** The game index drawn at a screen position. */
export function indexAt(viewRow: number, viewCol: number, cols: number, transposed: boolean): number {
  const row = transposed ? viewCol : viewRow;
  const col = transposed ? viewRow : viewCol;
  return row * cols + col;
}

/** Where on screen a game index is drawn. */
export function viewOf(index: number, cols: number, transposed: boolean): { viewRow: number; viewCol: number } {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return transposed ? { viewRow: col, viewCol: row } : { viewRow: row, viewCol: col };
}

/**
 * The cell the keyboard moves to: arrow keys follow the screen, so Down is
 * always the cell drawn below. Home and End go to the ends of the screen row,
 * or of the whole board with Ctrl. Null for any other key.
 */
export function moveInView(
  index: number,
  key: string,
  rows: number,
  cols: number,
  transposed: boolean,
  ctrl = false,
): number | null {
  const { viewRows, viewCols } = viewSize(rows, cols, transposed);
  const { viewRow, viewCol } = viewOf(index, cols, transposed);
  let r = viewRow;
  let c = viewCol;
  switch (key) {
    case 'ArrowUp':
      r = Math.max(0, r - 1);
      break;
    case 'ArrowDown':
      r = Math.min(viewRows - 1, r + 1);
      break;
    case 'ArrowLeft':
      c = Math.max(0, c - 1);
      break;
    case 'ArrowRight':
      c = Math.min(viewCols - 1, c + 1);
      break;
    case 'Home':
      if (ctrl) r = 0;
      c = 0;
      break;
    case 'End':
      if (ctrl) r = viewRows - 1;
      c = viewCols - 1;
      break;
    default:
      return null;
  }
  return indexAt(r, c, cols, transposed);
}
