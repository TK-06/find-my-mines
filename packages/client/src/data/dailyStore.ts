import {
  DAILY_PRESET,
  PUZZLE_HINTS_PER_GAME,
  dailyPuzzle,
  isDailyKey,
  puzzleClearedPercent,
  shiftDailyKey,
  type PuzzleGame,
} from '@fmm/shared';

/**
 * What Puzzle mode remembers about the Daily challenge: how each day's first
 * try went, the streak and best time worked out from that, and a Daily game
 * that is still under way — so a reload loses neither.
 *
 * Everything here is pure except the load / save functions at the bottom, which
 * only touch this browser's localStorage. There is no shared leaderboard: a
 * time measured in a browser is easy to fake, so the Daily is a streak and a
 * personal best, not a ranking. Nothing leaves the browser.
 */

/** How one day's first try ended. */
export interface DailyResult {
  won: boolean;
  /** The clock when it ended, in milliseconds. */
  ms: number;
  /** Hints used, 0 to 3. */
  hints: number;
  /** Whole percent of the safe cells open at the end: 100 for a win, at most 99 for a loss. */
  cleared: number;
}

export interface DailyRecords {
  /** The first try of each Bangkok day, by 'YYYY-MM-DD'. Old days are dropped — see `KEEP_DAYS`. */
  days: Partial<Record<string, DailyResult>>;
  /**
   * The longest run of consecutive first-try wins, ever. Kept beside `days`
   * rather than worked out from it, so dropping old days cannot lose it.
   */
  bestStreak: number;
  /** The fastest first-try win with no hints, in milliseconds. Kept for the same reason. */
  bestTime: number | null;
  /** First tries ever finished — the length of `days` plus every day dropped from it. */
  played: number;
}

/** Days of history kept. A year and a bit: enough for any streak anyone will have. */
export const KEEP_DAYS = 400;

export function emptyDailyRecords(): DailyRecords {
  return { days: {}, bestStreak: 0, bestTime: null, played: 0 };
}

/** The result of a finished game, for the day's record. */
export function dailyResultOf(game: PuzzleGame, ms: number): DailyResult {
  return {
    won: game.status === 'won',
    ms: Math.max(0, Math.round(ms)),
    hints: game.hintsUsed,
    cleared: puzzleClearedPercent(game),
  };
}

/** Only a win with no hints may set the best Daily time — the same rule as the levels. */
function setsBestTime(result: DailyResult): boolean {
  return result.won && result.hints === 0;
}

/** The fastest hint-free win among the days, or null. */
function bestTimeOf(days: DailyRecords['days']): number | null {
  let best: number | null = null;
  for (const result of Object.values(days)) {
    if (result && setsBestTime(result) && (best === null || result.ms < best)) best = result.ms;
  }
  return best;
}

/** The smaller of the numbers that exist. */
function smallest(...times: (number | null)[]): number | null {
  const found = times.filter((time): time is number => time !== null);
  return found.length > 0 ? Math.min(...found) : null;
}

/**
 * The run of first-try wins that ends today — or yesterday, when today has not
 * been played yet: a day still to play does not break a streak. A loss today
 * ends it; so does any day with no first try.
 */
export function currentStreak(days: DailyRecords['days'], today: string): number {
  let cursor = days[today] ? today : shiftDailyKey(today, -1);
  let streak = 0;
  while (cursor !== null && days[cursor]?.won) {
    streak++;
    cursor = shiftDailyKey(cursor, -1);
  }
  return streak;
}

/** The longest run of consecutive first-try wins among the days kept. */
export function longestStreak(days: DailyRecords['days']): number {
  let best = 0;
  let run = 0;
  let lastWin: string | null = null;
  // 'YYYY-MM-DD' sorts as dates do.
  for (const key of Object.keys(days).sort()) {
    if (days[key]?.won) {
      run = lastWin !== null && shiftDailyKey(key, -1) === lastWin ? run + 1 : 1;
      lastWin = key;
      best = Math.max(best, run);
    } else {
      run = 0;
      lastWin = null;
    }
  }
  return best;
}

/** Drops days more than `KEEP_DAYS` before the newest one. */
function pruneDays(days: DailyRecords['days'], newest: string): DailyRecords['days'] {
  const cutoff = shiftDailyKey(newest, -KEEP_DAYS);
  if (cutoff === null) return days;
  const kept: DailyRecords['days'] = {};
  for (const [key, result] of Object.entries(days)) {
    if (key >= cutoff) kept[key] = result;
  }
  return kept;
}

/** The latest of some day keys. */
function newestKey(keys: string[]): string | null {
  return keys.length > 0 ? keys.reduce((a, b) => (b > a ? b : a)) : null;
}

/**
 * Records a day's first try. A day that already has one is left alone — the
 * first try is the result, whatever happens after — and so is a key that is not
 * a date. Returns the very same object when nothing changed.
 */
export function recordDailyResult(records: DailyRecords, key: string, result: DailyResult): DailyRecords {
  if (!isDailyKey(key) || records.days[key] !== undefined) return records;
  const days = pruneDays({ ...records.days, [key]: result }, key);
  return {
    days,
    bestStreak: Math.max(records.bestStreak, longestStreak(days)),
    bestTime: setsBestTime(result) ? smallest(records.bestTime, result.ms) : records.bestTime,
    played: records.played + 1,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWhole = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

function parseResult(value: unknown): DailyResult | null {
  if (!isRecord(value)) return null;
  const { won, ms, hints, cleared } = value;
  if (typeof won !== 'boolean') return null;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  if (!isWhole(hints, PUZZLE_HINTS_PER_GAME) || !isWhole(cleared, 100)) return null;
  return { won, ms, hints, cleared };
}

/**
 * Reads stored Daily records, tolerating anything a user or an old version left
 * there: junk gives empty records, a bad day is skipped, and the totals are
 * never lower than what the days themselves show.
 */
export function parseDailyRecords(raw: string | null): DailyRecords {
  if (!raw) return emptyDailyRecords();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyDailyRecords();

    const found: DailyRecords['days'] = {};
    if (isRecord(parsed.days)) {
      for (const [key, value] of Object.entries(parsed.days)) {
        const result = isDailyKey(key) ? parseResult(value) : null;
        if (result) found[key] = result;
      }
    }
    const newest = newestKey(Object.keys(found));
    const days = newest === null ? found : pruneDays(found, newest);
    const storedTime = typeof parsed.bestTime === 'number' && parsed.bestTime >= 0 ? parsed.bestTime : null;
    return {
      days,
      bestStreak: Math.max(isWhole(parsed.bestStreak) ? parsed.bestStreak : 0, longestStreak(days)),
      bestTime: smallest(storedTime, bestTimeOf(days)),
      played: Math.max(isWhole(parsed.played) ? parsed.played : 0, Object.keys(days).length),
    };
  } catch {
    return emptyDailyRecords();
  }
}

/**
 * Two views of the records, as one: every day from either, the stored one
 * winning when both have the same day (it finished first), the better of each
 * total. So a result recorded in another tab since this one loaded is kept
 * rather than overwritten.
 */
export function mergeDailyRecords(stored: DailyRecords, mine: DailyRecords): DailyRecords {
  const all = { ...mine.days, ...stored.days };
  const newest = newestKey(Object.keys(all));
  const days = newest === null ? all : pruneDays(all, newest);
  const fresh = Object.keys(mine.days).filter((key) => stored.days[key] === undefined).length;
  return {
    days,
    bestStreak: Math.max(stored.bestStreak, mine.bestStreak, longestStreak(days)),
    bestTime: smallest(stored.bestTime, mine.bestTime, bestTimeOf(days)),
    played: Math.max(mine.played, stored.played + fresh),
  };
}

/* ── a Daily game under way ───────────────────────────────────────────────
 * Only what the player changed is kept: which cells are open or flagged, the
 * hints used and when the clock started. The mines and numbers are not stored —
 * they are rebuilt from the day's key, the same on every device, so a saved
 * game can neither disagree with the board nor be edited into a different one.
 */

export interface SavedDaily {
  /** The Bangkok day the game belongs to — the day it was started, even if it ends after midnight. */
  key: string;
  /** When the first cell was opened (ms since the epoch), or null if none has been yet. */
  startedAt: number | null;
  hintsUsed: number;
  /** Indices of the open cells and the flagged ones. */
  open: number[];
  flagged: number[];
}

/** The part of a first-try game worth keeping across a reload. */
export function makeSavedDaily(key: string, game: PuzzleGame, startedAt: number | null): SavedDaily {
  const indices = (cells: readonly boolean[]) => cells.flatMap((on, index) => (on ? [index] : []));
  return { key, startedAt, hintsUsed: game.hintsUsed, open: indices(game.open), flagged: indices(game.flagged) };
}

const DAILY_CELLS = DAILY_PRESET.rows * DAILY_PRESET.cols;

function cellList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > DAILY_CELLS) return null;
  return value.every((index) => isWhole(index, DAILY_CELLS - 1)) ? (value as number[]) : null;
}

/** Reads a saved Daily game, or null for anything that is not one. */
export function parseSavedDaily(raw: string | null): SavedDaily | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isDailyKey(parsed.key)) return null;
    const { startedAt, hintsUsed } = parsed;
    if (startedAt !== null && (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt < 0)) return null;
    if (!isWhole(hintsUsed, PUZZLE_HINTS_PER_GAME)) return null;
    const open = cellList(parsed.open);
    const flagged = cellList(parsed.flagged);
    if (open === null || flagged === null) return null;
    return { key: parsed.key, startedAt, hintsUsed, open, flagged };
  } catch {
    return null;
  }
}

/**
 * The saved game rebuilt on the day's real board, with the clock as it was; null
 * when it does not fit that board (an open mine, a flag on an open cell, the
 * opening closed again) or is already won — then there is nothing to resume.
 */
export function restoreSavedDaily(saved: SavedDaily): { game: PuzzleGame; startedAt: number | null } | null {
  const base = dailyPuzzle(saved.key);
  const open = new Array<boolean>(DAILY_CELLS).fill(false);
  for (const index of saved.open) {
    if (base.mines[index]) return null;
    open[index] = true;
  }
  // The opening was open from the start, and open cells never close.
  if (base.open.some((isOpen, index) => isOpen && !open[index])) return null;
  const flagged = new Array<boolean>(DAILY_CELLS).fill(false);
  for (const index of saved.flagged) {
    if (open[index]) return null;
    flagged[index] = true;
  }
  if (open.filter(Boolean).length >= DAILY_CELLS - base.mineCount) return null;
  return { game: { ...base, open, flagged, hintsUsed: saved.hintsUsed }, startedAt: saved.startedAt };
}

/* ── this browser's localStorage ──────────────────────────────────────────
 * Storage can be unavailable (private windows, blocked site data); the Daily
 * then plays the same and simply forgets on reload.
 */

const RECORDS_KEY = 'fmm.puzzleDaily';
const GAME_KEY = 'fmm.puzzleDailyGame';

export function loadDailyRecords(): DailyRecords {
  try {
    return parseDailyRecords(localStorage.getItem(RECORDS_KEY));
  } catch {
    return emptyDailyRecords();
  }
}

/** Saves the records, merged with whatever is stored now — see `mergeDailyRecords`. */
export function saveDailyRecords(records: DailyRecords): void {
  try {
    const merged = mergeDailyRecords(parseDailyRecords(localStorage.getItem(RECORDS_KEY)), records);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(merged));
  } catch {
    // Not saved — the result still shows for this visit.
  }
}

/**
 * The Daily game left unfinished, if it is from `today`. One from an earlier day
 * is dropped here: the day moved on, so it counts as not played.
 */
export function loadSavedDaily(today: string): SavedDaily | null {
  try {
    const saved = parseSavedDaily(localStorage.getItem(GAME_KEY));
    if (saved !== null && saved.key !== today) {
      localStorage.removeItem(GAME_KEY);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export function saveSavedDaily(saved: SavedDaily): void {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(saved));
  } catch {
    // Not saved — a reload will not bring this game back.
  }
}

export function clearSavedDaily(): void {
  try {
    localStorage.removeItem(GAME_KEY);
  } catch {
    // Nothing to clear.
  }
}
