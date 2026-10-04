import {
  PUZZLE_LEVELS,
  PUZZLE_PRESETS,
  countsForBest,
  createRng,
  dailyPuzzle,
  flagPuzzleCell,
  isPuzzleLevel,
  newPuzzle,
  playPuzzleCell,
  takePuzzleHint,
  type PuzzleGame,
  type PuzzleHint,
  type PuzzleLevel,
} from '@fmm/shared';
import {
  dailyResultOf,
  emptyDailyRecords,
  makeSavedDaily,
  mergeDailyRecords,
  recordDailyResult,
  restoreSavedDaily,
  type DailyRecords,
  type SavedDaily,
} from './dailyStore.js';

/**
 * Everything the Puzzle screen remembers, as a pure reducer: the game, its
 * clock, the hint on the board, the best times and the Daily records.
 *
 * The rules themselves live in the shared engine (engine/puzzle.ts); this adds
 * what only the screen cares about. Nothing here talks to the server or to
 * Supabase — puzzle mode works signed out and offline. Best times and Daily
 * results stay in this browser's localStorage (see dailyStore.ts).
 */

/** Fastest hint-free win per level, in milliseconds. */
export type BestTimes = Partial<Record<PuzzleLevel, number>>;

/** What the screen is playing: one of the three levels, or the day's Daily. */
export type PuzzleMode = PuzzleLevel | 'daily';

export interface PuzzleSession {
  mode: PuzzleMode;
  game: PuzzleGame;
  /** When the first cell was opened (ms since the epoch). Null until then. */
  startedAt: number | null;
  /** When the game was won or lost. Null while it runs. */
  endedAt: number | null;
  /** The hint on the board, until the board changes under it. */
  hint: PuzzleHint | null;
  best: BestTimes;
  /** This game set the level's best time. Never true for the Daily, which has its own. */
  newBest: boolean;
  /**
   * The Daily's day, 'YYYY-MM-DD', fixed when the game starts — so a game begun
   * before midnight still counts for the day it began. Null on a level.
   */
  day: string | null;
  /** A Daily replayed after its first try: shown as practice and never recorded. */
  practice: boolean;
  daily: DailyRecords;
  /** This game just ended as the day's first try, and `daily` now holds its result. */
  recorded: boolean;
}

/**
 * Moves carry their own random seed and timestamp, so the reducer stays pure —
 * React's StrictMode runs reducers twice, and both runs must lay the same mines.
 * Starting the Daily carries what the screen read from storage just now, for the
 * same reason (and so a result recorded in another tab is not missed).
 */
export type PuzzleAction =
  | { type: 'new'; level: PuzzleLevel }
  | { type: 'daily'; key: string; records: DailyRecords; saved: SavedDaily | null }
  | { type: 'practice' }
  | { type: 'play'; row: number; col: number; seed: number; now: number }
  | { type: 'flag'; row: number; col: number }
  | { type: 'hint' };

export function startSession(level: PuzzleLevel, best: BestTimes, daily: DailyRecords = emptyDailyRecords()): PuzzleSession {
  return {
    mode: level,
    game: newPuzzle(PUZZLE_PRESETS[level]),
    startedAt: null,
    endedAt: null,
    hint: null,
    best,
    newBest: false,
    day: null,
    practice: false,
    daily,
    recorded: false,
  };
}

/**
 * The day's Daily. The board is the same for everyone, opening already open,
 * and a game that is already under way is picked up where it was: the clock
 * keeps counting from the original first click. A day that already has a first
 * try is practice — a fresh board, never recorded.
 */
export function startDailySession(
  key: string,
  best: BestTimes,
  records: DailyRecords,
  saved: SavedDaily | null,
): PuzzleSession {
  const practice = records.days[key] !== undefined;
  const resumed = !practice && saved !== null && saved.key === key ? restoreSavedDaily(saved) : null;
  return {
    mode: 'daily',
    game: resumed?.game ?? dailyPuzzle(key),
    startedAt: resumed?.startedAt ?? null,
    endedAt: null,
    hint: null,
    best,
    newBest: false,
    day: key,
    practice,
    daily: records,
    recorded: false,
  };
}

/**
 * Where the page opens: on the easy level as ever, unless a Daily from today was
 * left unfinished — then back in it, so a reload is neither a free retry nor a
 * lost game.
 */
export function openingSession(
  best: BestTimes,
  records: DailyRecords,
  saved: SavedDaily | null,
  today: string,
): PuzzleSession {
  const resumable =
    saved !== null && saved.key === today && records.days[today] === undefined && restoreSavedDaily(saved) !== null;
  return resumable ? startDailySession(today, best, records, saved) : startSession('easy', best, records);
}

/**
 * The part of an unfinished first-try Daily worth saving, or null when there is
 * nothing to keep: not a Daily, a practice game, one that has ended (its result
 * is recorded instead), or one nothing has happened in — reloading that just
 * opens the same board.
 */
export function dailyProgress(session: PuzzleSession): SavedDaily | null {
  if (session.mode !== 'daily' || session.practice || session.day === null) return null;
  if (session.game.status !== 'playing') return null;
  if (session.startedAt === null && session.game.hintsUsed === 0) return null;
  return makeSavedDaily(session.day, session.game, session.startedAt);
}

export function puzzleReducer(session: PuzzleSession, action: PuzzleAction): PuzzleSession {
  switch (action.type) {
    case 'new':
      return startSession(action.level, session.best, session.daily);

    case 'daily': {
      // Already on this day's board: pressing Daily again must not hand out a
      // fresh one — least of all in the middle of the first try.
      if (session.mode === 'daily' && session.day === action.key) return session;
      // What this session knows and what storage holds, so a result is never lost from either.
      const records = mergeDailyRecords(action.records, session.daily);
      return startDailySession(action.key, session.best, records, action.saved);
    }

    case 'practice': {
      if (session.mode !== 'daily' || session.day === null) return session;
      // The first try is not for restarting: until it ends there is no practice.
      if (!session.practice && session.game.status === 'playing') return session;
      return { ...startDailySession(session.day, session.best, session.daily, null), practice: true };
    }

    case 'play': {
      const game = playPuzzleCell(session.game, action.row, action.col, createRng(action.seed));
      if (game === session.game) return session;
      // The clock starts with the first cell opened — the click that lays the
      // mines on a level, the first click on the Daily's ready-made board.
      const startedAt = session.startedAt ?? action.now;
      const over = game.status === 'won' || game.status === 'lost';
      const endedAt = over ? action.now : null;
      const time = Math.max(0, action.now - startedAt);

      // The Daily has its own best time; its opening is free, so it never sets Medium's.
      let best = session.best;
      let newBest = false;
      if (session.mode !== 'daily' && countsForBest(game)) {
        const previous = best[session.mode];
        if (previous === undefined || time < previous) {
          best = { ...best, [session.mode]: time };
          newBest = true;
        }
      }

      // The day's first try, when it ends, is the day's result — won or lost.
      let daily = session.daily;
      if (over && session.mode === 'daily' && session.day !== null && !session.practice) {
        daily = recordDailyResult(daily, session.day, dailyResultOf(game, time));
      }
      const recorded = daily !== session.daily;

      // Any opened cell changes the numbers, so the old hint may no longer be
      // the safest cell — or safe at all. It goes rather than mislead.
      return { ...session, game, startedAt, endedAt, hint: null, best, newBest, daily, recorded };
    }

    case 'flag': {
      const game = flagPuzzleCell(session.game, action.row, action.col);
      if (game === session.game) return session;
      // Flags are not facts to the solver, so the hint still holds — unless the
      // flag went on (or came off) the very cell it points at. Taking the flag
      // off a "take your flag off it" hint is following it: the hint stays, as
      // a plain safe cell to open.
      const hint = session.hint;
      if (hint === null || hint.row !== action.row || hint.col !== action.col) return { ...session, game };
      const unflagged = hint.flagged && !game.flagged[action.row * game.cols + action.col];
      return { ...session, game, hint: unflagged ? { ...hint, flagged: false } : null };
    }

    case 'hint': {
      // One at a time: asking again would spend a hint on the same cell.
      if (session.hint) return session;
      const taken = takePuzzleHint(session.game);
      if (!taken) return session;
      return { ...session, game: taken.game, hint: taken.hint };
    }
  }
}

/** Time on the clock: zero before the first click, frozen once the game ends. */
export function elapsedMs(session: Pick<PuzzleSession, 'startedAt' | 'endedAt'>, now: number): number {
  if (session.startedAt === null) return 0;
  return Math.max(0, (session.endedAt ?? now) - session.startedAt);
}

/** Three digits, like the classic counters: 007, -03, capped at 999 and -99. */
export function clockDigits(value: number): string {
  const n = Math.trunc(value);
  if (n < 0) return `-${String(Math.min(99, -n)).padStart(2, '0')}`;
  return String(Math.min(999, n)).padStart(3, '0');
}

/** "41.3 s" */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** "2:31": whole seconds as minutes and seconds, the way the Daily shows and shares a time. */
export function formatMinutes(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Reads stored best times, tolerating anything a user or an old version left there. */
export function parseBestTimes(raw: string | null): BestTimes {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const best: BestTimes = {};
    for (const [level, time] of Object.entries(parsed)) {
      if (isPuzzleLevel(level) && typeof time === 'number' && Number.isFinite(time) && time >= 0) {
        best[level] = time;
      }
    }
    return best;
  } catch {
    return {};
  }
}

/** The faster time per level from both. */
export function mergeBestTimes(a: BestTimes, b: BestTimes): BestTimes {
  const best: BestTimes = {};
  for (const level of PUZZLE_LEVELS) {
    const times = [a[level], b[level]].filter((t): t is number => t !== undefined);
    if (times.length > 0) best[level] = Math.min(...times);
  }
  return best;
}

const STORAGE_KEY = 'fmm.puzzleBest';

// Storage can be unavailable (private windows, blocked site data); puzzle mode
// then plays the same and simply forgets best times on reload.

export function loadBestTimes(): BestTimes {
  try {
    return parseBestTimes(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/**
 * Saves best times, merged with whatever is stored now, so a record set in
 * another tab since this one loaded is kept rather than overwritten.
 */
export function saveBestTimes(best: BestTimes): void {
  try {
    const merged = mergeBestTimes(parseBestTimes(localStorage.getItem(STORAGE_KEY)), best);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Not saved — the time still shows for this visit.
  }
}
