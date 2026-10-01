import { PUZZLE_HINTS_PER_GAME, puzzleFromMines, type PuzzleGame } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import {
  clockDigits,
  elapsedMs,
  formatSeconds,
  mergeBestTimes,
  parseBestTimes,
  puzzleReducer,
  startSession,
  type PuzzleSession,
} from './puzzleStore.js';

/** A game already under way, from an ASCII map: '*' is a mine, '.' is safe. */
function fromMap(map: string[]): PuzzleGame {
  const mines = map.flatMap((line) => [...line].map((ch) => ch === '*'));
  return puzzleFromMines(map.length, map[0]!.length, mines);
}

/** A session part-way through a game on this map, started at t = 1000. */
function midGame(map: string[], extra: Partial<PuzzleSession> = {}): PuzzleSession {
  return { ...startSession('easy', {}), game: fromMap(map), startedAt: 1000, ...extra };
}

const play = (row: number, col: number, now: number) => ({ type: 'play', row, col, seed: 1, now }) as const;

describe('startSession', () => {
  it('sets up the level’s board, not yet started, keeping the best times', () => {
    const session = startSession('hard', { easy: 5000 });
    expect(session.level).toBe('hard');
    expect(session.game.rows).toBe(16);
    expect(session.game.cols).toBe(30);
    expect(session.game.status).toBe('ready');
    expect(session.startedAt).toBeNull();
    expect(session.best).toEqual({ easy: 5000 });
  });
});

describe('puzzleReducer', () => {
  it('starts the clock on the first cell opened', () => {
    const session = puzzleReducer(startSession('easy', {}), play(4, 4, 100));
    expect(session.game.status).not.toBe('ready');
    expect(session.startedAt).toBe(100);
  });

  it('does not start the clock for a flag', () => {
    const session = puzzleReducer(startSession('easy', {}), { type: 'flag', row: 0, col: 0 });
    expect(session.game.flagged[0]).toBe(true);
    expect(session.startedAt).toBeNull();
  });

  it('keeps the start time for later moves', () => {
    const session = puzzleReducer(midGame(['..*..', '..*..', '..*..']), play(1, 0, 4000));
    expect(session.startedAt).toBe(1000);
    expect(session.endedAt).toBeNull();
  });

  it('stops the clock when the game ends', () => {
    const lost = puzzleReducer(midGame(['*..', '...', '...']), play(0, 0, 7000));
    expect(lost.game.status).toBe('lost');
    expect(lost.endedAt).toBe(7000);
    expect(lost.newBest).toBe(false);
  });

  it('records a first win as the best time', () => {
    const won = puzzleReducer(midGame(['*..', '...', '...']), play(2, 2, 5000));
    expect(won.game.status).toBe('won');
    expect(won.best).toEqual({ easy: 4000 });
    expect(won.newBest).toBe(true);
  });

  it('replaces the best time only when beaten', () => {
    const faster = puzzleReducer(midGame(['*..', '...', '...'], { best: { easy: 9000 } }), play(2, 2, 5000));
    expect(faster.best.easy).toBe(4000);
    expect(faster.newBest).toBe(true);
    const slower = puzzleReducer(midGame(['*..', '...', '...'], { best: { easy: 3000 } }), play(2, 2, 5000));
    expect(slower.best.easy).toBe(3000);
    expect(slower.newBest).toBe(false);
  });

  it('never records a win that used a hint', () => {
    let session = midGame(['*..', '...', '...']);
    session = puzzleReducer(session, { type: 'hint' });
    expect(session.game.hintsUsed).toBe(1);
    session = puzzleReducer(session, play(2, 2, 5000));
    expect(session.game.status).toBe('won');
    expect(session.best).toEqual({});
    expect(session.newBest).toBe(false);
  });

  it('shows one hint at a time, and clears it once the board changes', () => {
    let session = puzzleReducer(midGame(['..*..', '..*..', '..*..']), { type: 'hint' });
    expect(session.hint).not.toBeNull();
    expect(puzzleReducer(session, { type: 'hint' })).toBe(session);
    session = puzzleReducer(session, play(1, 0, 2000));
    expect(session.hint).toBeNull();
  });

  it('keeps the hint when another cell is flagged, and drops it when its own cell is', () => {
    let session = puzzleReducer(midGame(['..*..', '..*..', '..*..']), { type: 'hint' });
    const { row, col } = session.hint!;
    const elsewhere = row === 0 && col === 0 ? { row: 2, col: 4 } : { row: 0, col: 0 };
    session = puzzleReducer(session, { type: 'flag', ...elsewhere });
    expect(session.hint).not.toBeNull();
    session = puzzleReducer(session, { type: 'flag', row, col });
    expect(session.hint).toBeNull();
  });

  it('keeps a "take your flag off" hint when the player does just that', () => {
    let session = puzzleReducer(midGame(['..*..', '..*..', '..*..']), { type: 'flag', row: 0, col: 0 });
    session = { ...session, hint: { row: 0, col: 0, probability: 0, flagged: true } };
    session = puzzleReducer(session, { type: 'flag', row: 0, col: 0 });
    // Still pointing at A1, now as a plain safe cell to open.
    expect(session.hint).toEqual({ row: 0, col: 0, probability: 0, flagged: false });
    // Flagging it again goes against the hint, so the hint goes.
    session = puzzleReducer(session, { type: 'flag', row: 0, col: 0 });
    expect(session.hint).toBeNull();
  });

  it('gives no hint before the first click or past the limit', () => {
    const fresh = startSession('easy', {});
    expect(puzzleReducer(fresh, { type: 'hint' })).toBe(fresh);
    const spent = midGame(['..*..', '..*..', '..*..']);
    spent.game = { ...spent.game, hintsUsed: PUZZLE_HINTS_PER_GAME };
    expect(puzzleReducer(spent, { type: 'hint' })).toBe(spent);
  });

  it('returns the same session for a move that changes nothing', () => {
    const lost = puzzleReducer(midGame(['*..', '...', '...']), play(0, 0, 7000));
    expect(puzzleReducer(lost, play(2, 2, 8000))).toBe(lost);
    expect(puzzleReducer(lost, { type: 'flag', row: 2, col: 2 })).toBe(lost);
  });

  it('starts a new game on any level, keeping the best times', () => {
    const won = puzzleReducer(midGame(['*..', '...', '...']), play(2, 2, 5000));
    const next = puzzleReducer(won, { type: 'new', level: 'medium' });
    expect(next.level).toBe('medium');
    expect(next.game.status).toBe('ready');
    expect(next.game.rows).toBe(16);
    expect(next.startedAt).toBeNull();
    expect(next.newBest).toBe(false);
    expect(next.best).toEqual({ easy: 4000 });
  });
});

describe('elapsedMs', () => {
  it('is zero before the first click, runs while playing, and stops at the end', () => {
    expect(elapsedMs(startSession('easy', {}), 5000)).toBe(0);
    expect(elapsedMs(midGame(['*..']), 3500)).toBe(2500);
    expect(elapsedMs(midGame(['*..'], { endedAt: 2000 }), 9000)).toBe(1000);
  });

  it('never goes negative when the clock jumps back', () => {
    expect(elapsedMs(midGame(['*..']), 500)).toBe(0);
  });
});

describe('clockDigits', () => {
  it('shows three digits, like the classic counter', () => {
    expect(clockDigits(0)).toBe('000');
    expect(clockDigits(42)).toBe('042');
    expect(clockDigits(1234)).toBe('999');
    expect(clockDigits(-3)).toBe('-03');
    expect(clockDigits(-120)).toBe('-99');
  });
});

describe('formatSeconds', () => {
  it('shows tenths of a second', () => {
    expect(formatSeconds(41_320)).toBe('41.3 s');
    expect(formatSeconds(0)).toBe('0.0 s');
  });
});

describe('parseBestTimes', () => {
  it('reads back what was stored', () => {
    expect(parseBestTimes(JSON.stringify({ easy: 4000, hard: 90_000 }))).toEqual({ easy: 4000, hard: 90_000 });
  });

  it('treats nothing stored as no best times', () => {
    expect(parseBestTimes(null)).toEqual({});
  });

  it('survives corrupted storage instead of crashing the page', () => {
    expect(parseBestTimes('{not json')).toEqual({});
    expect(parseBestTimes('[1,2]')).toEqual({});
    expect(parseBestTimes('null')).toEqual({});
  });

  it('drops anything that is not a real time for a real level', () => {
    const raw = JSON.stringify({ easy: 'fast', medium: -5, hard: Infinity, expert: 100 });
    expect(parseBestTimes(raw)).toEqual({});
  });
});

describe('mergeBestTimes', () => {
  it('keeps the faster time per level, so another tab’s record is never lost', () => {
    expect(mergeBestTimes({ easy: 5000, medium: 60_000 }, { easy: 4000, hard: 99_000 })).toEqual({
      easy: 4000,
      medium: 60_000,
      hard: 99_000,
    });
  });
});
