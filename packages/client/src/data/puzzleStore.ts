import {
  PUZZLE_LEVELS,
  PUZZLE_PRESETS,
  countsForBest,
  createRng,
  flagPuzzleCell,
  isPuzzleLevel,
  newPuzzle,
  playPuzzleCell,
  takePuzzleHint,
  type PuzzleGame,
  type PuzzleHint,
  type PuzzleLevel,
} from '@fmm/shared';

/**
 * Everything the Puzzle screen remembers, as a pure reducer: the game, its
 * clock, the hint on the board and the best times.
 *
 * The rules themselves live in the shared engine (engine/puzzle.ts); this adds
 * what only the screen cares about. Nothing here talks to the server or to
 * Supabase — puzzle mode works signed out and offline. Best times stay in this
 * browser's localStorage.
 */

/** Fastest hint-free win per level, in milliseconds. */
export type BestTimes = Partial<Record<PuzzleLevel, number>>;

export interface PuzzleSession {
  level: PuzzleLevel;
  game: PuzzleGame;
  /** When the first cell was opened (ms since the epoch). Null until then. */
  startedAt: number | null;
  /** When the game was won or lost. Null while it runs. */
  endedAt: number | null;
  /** The hint on the board, until the board changes under it. */
  hint: PuzzleHint | null;
  best: BestTimes;
  /** This game set the level's best time. */
  newBest: boolean;
}

/**
 * Moves carry their own random seed and timestamp, so the reducer stays pure —
 * React's StrictMode runs reducers twice, and both runs must lay the same mines.
 */
export type PuzzleAction =
  | { type: 'new'; level: PuzzleLevel }
  | { type: 'play'; row: number; col: number; seed: number; now: number }
  | { type: 'flag'; row: number; col: number }
  | { type: 'hint' };

export function startSession(level: PuzzleLevel, best: BestTimes): PuzzleSession {
  return {
    level,
    game: newPuzzle(PUZZLE_PRESETS[level]),
    startedAt: null,
    endedAt: null,
    hint: null,
    best,
    newBest: false,
  };
}

export function puzzleReducer(session: PuzzleSession, action: PuzzleAction): PuzzleSession {
  switch (action.type) {
    case 'new':
      return startSession(action.level, session.best);

    case 'play': {
      const game = playPuzzleCell(session.game, action.row, action.col, createRng(action.seed));
      if (game === session.game) return session;
      // The clock starts with the first cell opened — the click that lays the mines.
      const startedAt = session.startedAt ?? action.now;
      const over = game.status === 'won' || game.status === 'lost';
      const endedAt = over ? action.now : null;

      let best = session.best;
      let newBest = false;
      if (countsForBest(game)) {
        const time = Math.max(0, action.now - startedAt);
        const previous = best[session.level];
        if (previous === undefined || time < previous) {
          best = { ...best, [session.level]: time };
          newBest = true;
        }
      }
      // Any opened cell changes the numbers, so the old hint may no longer be
      // the safest cell — or safe at all. It goes rather than mislead.
      return { ...session, game, startedAt, endedAt, hint: null, best, newBest };
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
