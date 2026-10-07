import { MIN_PLAYERS_TO_START } from './config.js';

/**
 * The record of one finished match, enough to play it back move by move and to
 * work out, at any move, what the players could and could not know.
 *
 * Built by the server from its own board and its own reveal order, sent to the
 * room only once the match is over (so the mines in it are no secret any more),
 * and saved with the match. Pure and I/O-free: the server, the review screen and
 * the coach all read the same shape.
 *
 * Cells are indexed row-major: `row * cols + col`.
 */

export const REPLAY_VERSION = 1;

/** Widest or tallest board a replay may describe. Rooms stop at 16; this leaves room to grow. */
export const REPLAY_MAX_SIDE = 32;

/**
 * Most seats a replay may list. A fixed room stops at `MAX_PLAYERS_LIMIT` (12),
 * but an unlimited room has no ceiling of its own, and a match played there must
 * still be recorded — so this is a generous bound against a hostile payload, not
 * the room limit. Stays under 100: the coach names players "Player 1" to "Player 99".
 */
export const REPLAY_MAX_SEATS = 64;

/** Longest seat name kept, in characters. A nickname is 20; a bot's name is a little longer. */
export const REPLAY_NAME_MAX = 40;

export interface ReplaySeat {
  name: string;
  /** A computer opponent. */
  bot: boolean;
}

/** One opened cell: where (`i`) and by which seat (`s`, an index into `seats`). */
export interface ReplayMove {
  i: number;
  s: number;
}

export interface Replay {
  v: typeof REPLAY_VERSION;
  rows: number;
  cols: number;
  mineCount: number;
  /** Where every mine was, as cell indices. */
  mines: number[];
  /** The seats in turn order, as they were at the start of the match. */
  seats: ReplaySeat[];
  /** The cells in the order they were opened. A match cut short just has fewer. */
  moves: ReplayMove[];
}

const MATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value could be a saved match's id (a UUID). Anything else is never sent to the database. */
export function isMatchId(value: unknown): value is string {
  return typeof value === 'string' && MATCH_ID.test(value);
}

/** The cell a row and column name. */
export function replayCell(cols: number, row: number, col: number): number {
  return row * cols + col;
}

/**
 * A replay from the server's own records: its board's mine grid, the seats and
 * the opened cells in order. The only place a `Board.bombs` grid is turned into
 * something that leaves the server — and only after the match has ended.
 */
export function buildReplay(input: {
  rows: number;
  cols: number;
  bombs: readonly (readonly boolean[])[];
  seats: readonly ReplaySeat[];
  moves: readonly { row: number; col: number; seat: number }[];
}): Replay {
  const { rows, cols, bombs } = input;
  const mines: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (bombs[row]?.[col]) mines.push(replayCell(cols, row, col));
    }
  }
  return {
    v: REPLAY_VERSION,
    rows,
    cols,
    mineCount: mines.length,
    mines,
    seats: input.seats.map((seat) => ({ name: seat.name, bot: seat.bot })),
    moves: input.moves.map((move) => ({ i: replayCell(cols, move.row, move.col), s: move.seat })),
  };
}

/** A whole number within [min, max]. */
function intIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** A name made safe to show and to put in a prompt: no control characters, trimmed, capped. */
function cleanName(raw: string): string {
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = Array.from(text).slice(0, REPLAY_NAME_MAX).join('').trimEnd();
  return name || 'Player';
}

/**
 * A replay from anything — a socket payload, a database column — or null when
 * it is not one. Strict, because the review screen and the coach build on it:
 *  - the version, board size, mine count and seat count are in range;
 *  - the mines are exactly `mineCount` different cells of the board;
 *  - every move is a different cell of the board, by a seat that exists;
 *  - no move comes after the last mine was found (the match ends there).
 * What comes back is a fresh copy with names cleaned, so nothing odd in the
 * input survives into the page or a prompt.
 */
export function parseReplay(input: unknown): Replay | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  if (raw.v !== REPLAY_VERSION) return null;
  if (!intIn(raw.rows, 1, REPLAY_MAX_SIDE) || !intIn(raw.cols, 1, REPLAY_MAX_SIDE)) return null;
  const { rows, cols } = raw;
  const total = rows * cols;
  if (!intIn(raw.mineCount, 1, total - 1)) return null;
  const mineCount = raw.mineCount;

  // The array lengths are checked before anything is walked, so an oversized
  // payload costs nothing to refuse.
  if (!Array.isArray(raw.mines) || raw.mines.length !== mineCount) return null;
  if (!Array.isArray(raw.seats) || raw.seats.length < MIN_PLAYERS_TO_START || raw.seats.length > REPLAY_MAX_SEATS) {
    return null;
  }
  if (!Array.isArray(raw.moves) || raw.moves.length > total) return null;

  const isMine = new Uint8Array(total);
  const mines: number[] = [];
  for (const cell of raw.mines as unknown[]) {
    if (!intIn(cell, 0, total - 1) || isMine[cell]) return null;
    isMine[cell] = 1;
    mines.push(cell);
  }

  const seats: ReplaySeat[] = [];
  for (const seat of raw.seats as unknown[]) {
    if (typeof seat !== 'object' || seat === null) return null;
    const { name, bot } = seat as Record<string, unknown>;
    if (typeof name !== 'string') return null;
    seats.push({ name: cleanName(name), bot: bot === true });
  }

  const opened = new Uint8Array(total);
  const moves: ReplayMove[] = [];
  let found = 0;
  for (const move of raw.moves as unknown[]) {
    if (typeof move !== 'object' || move === null) return null;
    const { i, s } = move as Record<string, unknown>;
    if (!intIn(i, 0, total - 1) || !intIn(s, 0, seats.length - 1) || opened[i]) return null;
    // The match is over once the last mine is found, so nothing can follow it.
    if (found === mineCount) return null;
    opened[i] = 1;
    if (isMine[i]) found++;
    moves.push({ i, s });
  }

  return { v: REPLAY_VERSION, rows, cols, mineCount, mines, seats, moves };
}

/** Mines in the eight cells around each cell, indexed like the board. */
export function replayAdjacency(replay: Pick<Replay, 'rows' | 'cols' | 'mines'>): number[] {
  const { rows, cols } = replay;
  const isMine = new Uint8Array(rows * cols);
  for (const cell of replay.mines) isMine[cell] = 1;

  const counts = new Array<number>(rows * cols).fill(0);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr;
          const c = col + dc;
          if ((dr === 0 && dc === 0) || r < 0 || r >= rows || c < 0 || c >= cols) continue;
          count += isMine[r * cols + c]!;
        }
      }
      counts[row * cols + col] = count;
    }
  }
  return counts;
}

/** Whether the match ran until every mine was found, rather than being cut short by someone leaving. */
export function replayComplete(replay: Pick<Replay, 'mines' | 'moves'>): boolean {
  const isMine = new Set(replay.mines);
  return replay.moves.filter((move) => isMine.has(move.i)).length === replay.mines.length;
}
