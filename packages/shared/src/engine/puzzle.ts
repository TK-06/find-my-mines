import { randomInt, type Rng } from './rng.js';
import { mineProbabilities, type SolverCell, type SolverView } from './solver.js';

/**
 * Puzzle mode: classic single-player Minesweeper.
 *
 * Unlike a multiplayer match, this game runs entirely in one browser, so the
 * mines live on the client. That is fine here — there is no opponent to hide
 * them from, and nothing is scored or rated — but it is the opposite of the
 * multiplayer rule, where `Board.bombs` never leaves the server. Nothing in
 * this file is used by a match.
 *
 * Every function is pure: it returns a new game when something changed and
 * the very same object when nothing did, so a caller can tell a no-op apart
 * with `===`. Cells are indexed row-major (row * cols + col).
 */

export type PuzzleLevel = 'easy' | 'medium' | 'hard';

export interface PuzzlePreset {
  rows: number;
  cols: number;
  mines: number;
}

export const PUZZLE_LEVELS: readonly PuzzleLevel[] = ['easy', 'medium', 'hard'];

/** The classic three. Hard is 30 wide and 16 tall, as it has always been. */
export const PUZZLE_PRESETS: Record<PuzzleLevel, PuzzlePreset> = {
  easy: { rows: 9, cols: 9, mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 },
};

/** Hints one game may use. A game that uses any does not set a best time. */
export const PUZZLE_HINTS_PER_GAME = 3;

/** `ready` until the first cell is opened, which is when the mines are laid. */
export type PuzzleStatus = 'ready' | 'playing' | 'won' | 'lost';

export interface PuzzleGame {
  rows: number;
  cols: number;
  mineCount: number;
  status: PuzzleStatus;
  /** Where the mines are. All false until the first cell is opened. */
  mines: boolean[];
  /** Mines in the eight neighbours of each cell. */
  adjacent: number[];
  /** Safe cells the player has opened. A mine that went off is in `exploded` instead. */
  open: boolean[];
  flagged: boolean[];
  /** The mines the player opened — one, or more when a chord hit several. */
  exploded: number[];
  hintsUsed: number;
}

/** What a cell shows. Mines appear only once the game is lost. */
export type PuzzleCellState = 'covered' | 'flagged' | 'open' | 'mine' | 'exploded' | 'wrong-flag';

/** The cell a hint points at, and the solver's chance that it is a mine. */
export interface PuzzleHint {
  row: number;
  col: number;
  probability: number;
  /**
   * The cell carries a flag. Only happens when every unflagged cell is a
   * certain mine — then the useful thing to say is which flag is wrong.
   */
  flagged: boolean;
}

export function isPuzzleLevel(value: unknown): value is PuzzleLevel {
  return typeof value === 'string' && (PUZZLE_LEVELS as readonly string[]).includes(value);
}

/**
 * A fresh board with no mines yet. They are laid by the first click, so that
 * the first click can always be made safe.
 */
export function newPuzzle(preset: PuzzlePreset): PuzzleGame {
  const rows = Math.max(1, Math.floor(preset.rows));
  const cols = Math.max(1, Math.floor(preset.cols));
  const total = rows * cols;
  // At least one cell has to be free for the first click.
  const mineCount = Math.min(Math.max(0, Math.floor(preset.mines)), total - 1);
  return {
    rows,
    cols,
    mineCount,
    status: 'ready',
    mines: new Array<boolean>(total).fill(false),
    adjacent: new Array<number>(total).fill(0),
    open: new Array<boolean>(total).fill(false),
    flagged: new Array<boolean>(total).fill(false),
    exploded: [],
    hintsUsed: 0,
  };
}

/**
 * A game with these mines already laid, as if the first click had just
 * happened but opened nothing. For tests and hand-made puzzles.
 */
export function puzzleFromMines(rows: number, cols: number, mines: readonly boolean[]): PuzzleGame {
  const layout = Array.from({ length: rows * cols }, (_, index) => mines[index] === true);
  const game = newPuzzle({ rows, cols, mines: 0 });
  return {
    ...game,
    mineCount: layout.filter(Boolean).length,
    status: 'playing',
    mines: layout,
    adjacent: countAdjacent(rows, cols, layout),
  };
}

/**
 * The main click (or Enter / Space): opens a covered cell, or chords an open
 * number. Flagged cells are left alone — a flag is there to stop exactly this.
 */
export function playPuzzleCell(game: PuzzleGame, row: number, col: number, rng: Rng): PuzzleGame {
  const index = indexOf(game, row, col);
  if (index === null || game.status === 'won' || game.status === 'lost') return game;
  if (game.flagged[index]) return game;
  if (game.open[index]) return chord(game, index);
  const laid = game.status === 'ready' ? layMines(game, index, rng) : game;
  return openCells(laid, [index]);
}

/** Right click, long press or F: puts a flag on a covered cell, or takes it off. */
export function flagPuzzleCell(game: PuzzleGame, row: number, col: number): PuzzleGame {
  const index = indexOf(game, row, col);
  if (index === null || game.status === 'won' || game.status === 'lost') return game;
  if (game.open[index]) return game;
  const flagged = [...game.flagged];
  flagged[index] = !flagged[index];
  return { ...game, flagged };
}

/** The counter: mines minus flags. Goes below zero when there are too many flags, as it always has. */
export function puzzleMinesLeft(game: PuzzleGame): number {
  return game.mineCount - game.flagged.filter(Boolean).length;
}

export function puzzleCellState(game: PuzzleGame, index: number): PuzzleCellState {
  if (game.open[index]) return 'open';
  if (game.status === 'lost') {
    if (game.exploded.includes(index)) return 'exploded';
    if (game.mines[index]) return game.flagged[index] ? 'flagged' : 'mine';
    if (game.flagged[index]) return 'wrong-flag';
    return 'covered';
  }
  return game.flagged[index] ? 'flagged' : 'covered';
}

/** A win with no hints — the only kind that may set a best time. */
export function countsForBest(game: PuzzleGame): boolean {
  return game.status === 'won' && game.hintsUsed === 0;
}

/**
 * Exactly what the player can see, for the solver: the open cells and their
 * numbers. Flags are left out on purpose — they are the player's guesses, not
 * facts, and a hint that trusted a wrong flag would lead them straight onto a
 * mine. Mines are never in it.
 */
export function puzzleView(game: PuzzleGame): SolverView {
  const revealed: SolverCell[] = [];
  game.open.forEach((isOpen, index) => {
    if (!isOpen) return;
    revealed.push({
      row: Math.floor(index / game.cols),
      col: index % game.cols,
      kind: 'empty',
      adjacent: game.adjacent[index]!,
    });
  });
  return { rows: game.rows, cols: game.cols, mineCount: game.mineCount, revealed };
}

/**
 * The safest cell to open next, worked out from the visible board only: the
 * covered, unflagged cell with the lowest chance of a mine (the first in
 * reading order on a tie). A flagged cell is named instead when the numbers
 * prove it safe and no unflagged cell is certain, or when every unflagged cell
 * is a certain mine — either way a flag is wrong, and that is the useful news.
 * Null before the first click — that one is always safe — and once the game is
 * over.
 */
export function puzzleHint(game: PuzzleGame): PuzzleHint | null {
  if (game.status !== 'playing') return null;
  const chances = mineProbabilities(puzzleView(game));
  let unflagged: PuzzleHint | null = null;
  let flagged: PuzzleHint | null = null;
  for (let row = 0; row < game.rows; row++) {
    for (let col = 0; col < game.cols; col++) {
      const probability = chances[row]![col];
      if (probability === null || probability === undefined) continue;
      if (game.flagged[row * game.cols + col]) {
        if (!flagged || probability < flagged.probability) flagged = { row, col, probability, flagged: true };
      } else if (!unflagged || probability < unflagged.probability) {
        unflagged = { row, col, probability, flagged: false };
      }
    }
  }
  // A certain-safe flag beats a guess; a certain-safe open is as good and needs no unflagging.
  if (flagged && flagged.probability <= 0 && (!unflagged || unflagged.probability > 0)) return flagged;
  if (unflagged && unflagged.probability < 1) return unflagged;
  if (flagged && flagged.probability < 1) return flagged;
  return unflagged;
}

/** Spends one of the game's hints. Null when none are left or there is nothing to point at. */
export function takePuzzleHint(game: PuzzleGame): { game: PuzzleGame; hint: PuzzleHint } | null {
  if (game.hintsUsed >= PUZZLE_HINTS_PER_GAME) return null;
  const hint = puzzleHint(game);
  if (!hint) return null;
  return { game: { ...game, hintsUsed: game.hintsUsed + 1 }, hint };
}

/** The sentence shown with a hint. */
export function describePuzzleHint(hint: PuzzleHint): string {
  const cell = puzzleCellLabel(hint);
  // The solver gives exactly 0 for a cell the numbers prove safe.
  if (hint.probability <= 0) {
    return hint.flagged ? `${cell} is safe for sure — take your flag off it.` : `${cell} is safe for sure.`;
  }
  // Kept between 1 and 99 so a guess never reads as "0% risk" or "100%".
  const percent = Math.min(99, Math.max(1, Math.round(hint.probability * 100)));
  const where = hint.flagged ? `${cell} (flagged)` : cell;
  return `No cell is certain — ${where} is the safest bet, about ${percent}% risk.`;
}

/**
 * "C4", "AD16": column letters as a spreadsheet writes them, because the
 * 30-wide board runs past Z. Matches `cellLabel` for the first 26 columns.
 */
export function puzzleCellLabel(cell: { row: number; col: number }): string {
  return `${puzzleColumnName(cell.col)}${cell.row + 1}`;
}

export function puzzleColumnName(col: number): string {
  let name = '';
  for (let n = Math.max(0, Math.floor(col)) + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function indexOf(game: PuzzleGame, row: number, col: number): number | null {
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  if (row < 0 || row >= game.rows || col < 0 || col >= game.cols) return null;
  return row * game.cols + col;
}

/** The up-to-eight cells around one, as indices. */
function neighbours(rows: number, cols: number, index: number): number[] {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if ((dr !== 0 || dc !== 0) && r >= 0 && r < rows && c >= 0 && c < cols) out.push(r * cols + c);
    }
  }
  return out;
}

function countAdjacent(rows: number, cols: number, mines: readonly boolean[]): number[] {
  return mines.map((_, index) => neighbours(rows, cols, index).filter((n) => mines[n]).length);
}

/**
 * Lays the mines at random, keeping the first click and its neighbours clear
 * so the first click always lands on a 0 and opens a region. On a board too
 * crowded to spare the neighbours, only the clicked cell is kept clear.
 */
function layMines(game: PuzzleGame, first: number, rng: Rng): PuzzleGame {
  const { rows, cols, mineCount } = game;
  const clear = new Set([first, ...neighbours(rows, cols, first)]);
  let spots = game.mines.map((_, index) => index).filter((index) => !clear.has(index));
  if (spots.length < mineCount) spots = game.mines.map((_, index) => index).filter((index) => index !== first);

  // Partial Fisher-Yates, as `createBoard` does: distinct spots, exact count.
  const mines = new Array<boolean>(rows * cols).fill(false);
  for (let i = 0; i < mineCount; i++) {
    const j = i + randomInt(rng, spots.length - i);
    [spots[i], spots[j]] = [spots[j]!, spots[i]!];
    mines[spots[i]!] = true;
  }
  return { ...game, status: 'playing', mines, adjacent: countAdjacent(rows, cols, mines) };
}

/**
 * Opens the given covered cells. Any 0 among them opens its whole region, by
 * a flood fill over an explicit stack rather than recursion, so board size
 * cannot overflow the call stack. Flagged cells stop the flood.
 */
function openCells(game: PuzzleGame, start: number[]): PuzzleGame {
  const open = [...game.open];
  const exploded = [...game.exploded];
  const stack: number[] = [];
  for (const index of start) {
    if (open[index] || game.flagged[index]) continue;
    if (game.mines[index]) {
      exploded.push(index);
      continue;
    }
    open[index] = true;
    stack.push(index);
  }
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (game.adjacent[index] !== 0) continue;
    // A 0 has no mine around it, so every neighbour is safe to open.
    for (const next of neighbours(game.rows, game.cols, index)) {
      if (open[next] || game.flagged[next]) continue;
      open[next] = true;
      stack.push(next);
    }
  }

  if (exploded.length > 0) return { ...game, open, exploded, status: 'lost' };
  const opened = open.filter(Boolean).length;
  if (opened === game.rows * game.cols - game.mineCount) {
    // Won: the mines left covered are flagged for the player.
    return { ...game, open, status: 'won', flagged: [...game.mines] };
  }
  return { ...game, open };
}

/**
 * Chording: on an open number whose flagged neighbours match it, opens all
 * its other covered neighbours at once. A wrong flag means one of them is a
 * mine — which is the risk the player takes by chording.
 */
function chord(game: PuzzleGame, index: number): PuzzleGame {
  const need = game.adjacent[index]!;
  if (need === 0) return game;
  const around = neighbours(game.rows, game.cols, index);
  const flags = around.filter((n) => game.flagged[n]).length;
  if (flags !== need) return game;
  const targets = around.filter((n) => !game.open[n] && !game.flagged[n]);
  return targets.length > 0 ? openCells(game, targets) : game;
}
