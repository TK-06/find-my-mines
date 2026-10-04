import { createRng, randomInt, type Rng } from './rng.js';
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

/**
 * How much of the board the player has cleared, as a whole percent of the safe
 * cells: 100 only for a win, never more than 99 otherwise — a loss that opened
 * the last safe cell and a mine in one chord should not read as "100% cleared".
 */
export function puzzleClearedPercent(game: PuzzleGame): number {
  if (game.status === 'won') return 100;
  // newPuzzle keeps at least one cell free of mines, so this is never zero.
  const safe = game.rows * game.cols - game.mineCount;
  const opened = game.open.filter(Boolean).length;
  return Math.min(99, Math.floor((opened / safe) * 100));
}

/* ── daily challenge ─────────────────────────────────────────────────────
 * One board a day, the same for everyone, with the same safe opening already
 * revealed so nobody starts ahead. Days are Bangkok days (UTC+7, which has no
 * daylight saving), worked out by plain arithmetic so no browser needs
 * time-zone data to agree on what day it is. Nothing here is stored or sent
 * anywhere: the board is rebuilt from the date.
 */

/**
 * The daily board's size: 16 × 16 with 40 mines — Medium's numbers, but kept
 * as its own constant so a later change to Medium never changes a board that
 * people have already played.
 */
export const DAILY_PRESET: PuzzlePreset = { rows: 16, cols: 16, mines: 40 };

/** The day of the first Daily, #1. Earlier days have no number. */
export const DAILY_FIRST_KEY = '2026-10-04';

const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** Mixed into the seed so the daily's boards are their own family, not just "the date". */
const DAILY_SEED_PREFIX = 'fmm-daily-v1:';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** UTC midnight of a calendar date as a timestamp, or null when the key is not a real date. */
function dayStart(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  // A date that rolled over (February 30th) or a two-digit year Date.UTC
  // bumped to 19xx is not the date that was written.
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time;
}

function keyOfDayStart(time: number): string | null {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** Is this a real calendar date written 'YYYY-MM-DD'? */
export function isDailyKey(value: unknown): value is string {
  return typeof value === 'string' && dayStart(value) !== null;
}

/**
 * The Bangkok calendar date of a moment, 'YYYY-MM-DD': the time plus seven
 * hours, read as UTC. 16:59:59.999 UTC is still today in Bangkok; 17:00:00 UTC
 * is the next day. A time that is not a number reads as the epoch.
 */
export function dailyKey(now: number): string {
  const time = Number.isFinite(now) ? now : 0;
  const key = keyOfDayStart(Math.floor((time + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS);
  // Past the dates a Date can hold. Not reachable by a clock, but never undefined.
  return key ?? '1970-01-01';
}

/**
 * The key a number of days before (negative) or after a key; null when the key
 * is not a real date or the result is out of range. Streaks walk back with this.
 */
export function shiftDailyKey(key: string, days: number): string | null {
  const start = dayStart(key);
  if (start === null || !Number.isInteger(days)) return null;
  return keyOfDayStart(start + days * DAY_MS);
}

/**
 * The day's number: 1 for 2026-10-04, one more each day. 0 means "no number" —
 * an invalid key, or a day before the first Daily (a device clock set wrong).
 */
export function dailyNumber(key: string): number {
  const start = dayStart(key);
  const first = dayStart(DAILY_FIRST_KEY);
  if (start === null || first === null) return 0;
  return Math.max(0, Math.round((start - first) / DAY_MS) + 1);
}

/** Milliseconds from a moment to the next Bangkok midnight, when the next Daily appears: (0, 24 h]. */
export function msUntilNextDaily(now: number): number {
  const local = (Number.isFinite(now) ? now : 0) + BANGKOK_OFFSET_MS;
  return (Math.floor(local / DAY_MS) + 1) * DAY_MS - local;
}

/** FNV-1a, 32 bits: a small, well-known string hash with the same answer everywhere. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The day's seed. NEVER change how this is worked out — not the prefix, not the
 * hash — once a Daily has shipped: the seed is the board, so any change gives
 * everyone a different board for every day, past ones included.
 */
export function dailySeed(key: string): number {
  return fnv1a32(DAILY_SEED_PREFIX + key);
}

/**
 * The opening cell: anywhere in the inner 14 × 14, never on the outer ring, so
 * the safe opening is always the full 3 × 3 and can only grow from there. (Anywhere
 * on the board would sometimes give a corner, which opens as few as four cells —
 * a poor start for a day everyone shares.)
 *
 * The order of the random draws here — row, then column, then the mines — is part
 * of the board. NEVER reorder or add a draw before them once shipped.
 */
function pickDailyOpening(rng: Rng): number {
  const row = 1 + randomInt(rng, DAILY_PRESET.rows - 2);
  const col = 1 + randomInt(rng, DAILY_PRESET.cols - 2);
  return row * DAILY_PRESET.cols + col;
}

/** The cell the day's opening is centred on, as an index (row * 16 + col). */
export function dailyOpening(key: string): number {
  return pickDailyOpening(createRng(dailySeed(key)));
}

/**
 * The day's board, the same on every device: a 16 × 16 board with 40 mines laid
 * the way the first click lays them (the opening and its neighbours stay clear),
 * and the opening already opened with the normal flood fill. It comes back
 * 'playing' with no hints used; mines exist from the start, unlike a level.
 *
 * Any string makes a board — this does not check the key. Callers that care use
 * `isDailyKey`.
 *
 * NEVER change the seed, the order of random draws below, or `layMines` /
 * `openCells` in a way that changes where the mines land once a Daily has
 * shipped, or everyone's board for the day changes. A test pins one day's mines
 * so an accidental change fails loudly.
 */
export function dailyPuzzle(key: string): PuzzleGame {
  const rng = createRng(dailySeed(key));
  const opening = pickDailyOpening(rng);
  const laid = layMines(newPuzzle(DAILY_PRESET), opening, rng);
  return openCells(laid, [opening]);
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
