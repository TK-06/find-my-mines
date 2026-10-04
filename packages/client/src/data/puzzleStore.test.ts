import { PUZZLE_HINTS_PER_GAME, dailyPuzzle, puzzleClearedPercent, puzzleFromMines, type PuzzleGame } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { emptyDailyRecords, makeSavedDaily, recordDailyResult, type DailyRecords } from './dailyStore.js';
import {
  clockDigits,
  dailyProgress,
  elapsedMs,
  formatMinutes,
  formatSeconds,
  mergeBestTimes,
  openingSession,
  parseBestTimes,
  puzzleReducer,
  startDailySession,
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
    expect(session.mode).toBe('hard');
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
    expect(next.mode).toBe('medium');
    expect(next.game.status).toBe('ready');
    expect(next.game.rows).toBe(16);
    expect(next.startedAt).toBeNull();
    expect(next.newBest).toBe(false);
    expect(next.best).toEqual({ easy: 4000 });
  });
});

describe('the Daily', () => {
  const DAY = '2026-10-04';
  const NEXT_DAY = '2026-10-05';

  /** The Daily opened from a fresh page: no records, nothing saved. */
  const openDaily = (records: DailyRecords = emptyDailyRecords(), best = {}): PuzzleSession =>
    puzzleReducer(startSession('easy', best, records), { type: 'daily', key: DAY, records, saved: null });

  const cell = (index: number) => [Math.floor(index / 16), index % 16] as const;
  /** The first covered cell that is safe and has no flag on it, and the first mine, on the day's board. */
  const safeCell = (session: PuzzleSession) =>
    cell(
      session.game.open.findIndex(
        (isOpen, index) => !isOpen && !session.game.mines[index] && !session.game.flagged[index],
      ),
    );
  const mineCell = (session: PuzzleSession) => cell(session.game.mines.indexOf(true));

  /** Opens every safe cell left, the clock starting at `start` and the last click landing at `end`. */
  function clearBoard(session: PuzzleSession, start: number, end: number): PuzzleSession {
    let next = session;
    let first = true;
    for (let index = 0; index < 256; index++) {
      if (next.game.mines[index] || next.game.open[index]) continue;
      next = puzzleReducer(next, play(...cell(index), first ? start : end));
      first = false;
    }
    return next;
  }

  describe('starting', () => {
    it('is the day’s board, already under way, with the clock waiting for the first click', () => {
      const session = openDaily(emptyDailyRecords(), { easy: 5000 });
      expect(session.mode).toBe('daily');
      expect(session.day).toBe(DAY);
      expect(session.practice).toBe(false);
      expect(session.game).toEqual(dailyPuzzle(DAY));
      expect(session.game.status).toBe('playing');
      expect(session.startedAt).toBeNull();
      expect(session.endedAt).toBeNull();
      expect(session.recorded).toBe(false);
      expect(session.best).toEqual({ easy: 5000 });
    });

    it('starts the clock at the first click on a cell, not when the board appears', () => {
      let session = openDaily();
      expect(session.startedAt).toBeNull();
      session = puzzleReducer(session, { type: 'flag', row: 0, col: 0 });
      expect(session.startedAt).toBeNull();
      // The opening is already open: clicking it does nothing, so the clock still waits.
      const opening = session.game.open.indexOf(true);
      expect(puzzleReducer(session, play(...cell(opening), 4000))).toBe(session);
      session = puzzleReducer(session, play(...safeCell(session), 5000));
      expect(session.startedAt).toBe(5000);
    });

    it('allows hints as usual, and counts them', () => {
      let session = openDaily();
      session = puzzleReducer(session, { type: 'hint' });
      expect(session.hint).not.toBeNull();
      expect(session.game.hintsUsed).toBe(1);
    });

    it('keeps the daily records when a level is picked, and the best times when the Daily is', () => {
      const records = recordDailyResult(emptyDailyRecords(), DAY, { won: true, ms: 90_000, hints: 0, cleared: 100 });
      const level = puzzleReducer(openDaily(records), { type: 'new', level: 'hard' });
      expect(level.mode).toBe('hard');
      expect(level.day).toBeNull();
      expect(level.daily).toEqual(records);
      expect(puzzleReducer(level, { type: 'daily', key: DAY, records, saved: null }).best).toEqual(level.best);
    });

    it('is not restarted by pressing Daily again, least of all mid-game', () => {
      let session = openDaily();
      session = puzzleReducer(session, play(...safeCell(session), 5000));
      expect(puzzleReducer(session, { type: 'daily', key: DAY, records: emptyDailyRecords(), saved: null })).toBe(session);
    });

    it('moves to the new day’s board when the day has changed under an open page', () => {
      const session = openDaily();
      const next = puzzleReducer(session, { type: 'daily', key: NEXT_DAY, records: emptyDailyRecords(), saved: null });
      expect(next.day).toBe(NEXT_DAY);
      expect(next.game).toEqual(dailyPuzzle(NEXT_DAY));
      expect(next.practice).toBe(false);
    });
  });

  describe('the first try', () => {
    it('records a win as the day’s result, with its time, and starts the best time and the streak', () => {
      const won = clearBoard(openDaily(), 1000, 91_000);
      expect(won.game.status).toBe('won');
      expect(won.endedAt).toBe(91_000);
      expect(won.recorded).toBe(true);
      expect(won.daily.days[DAY]).toEqual({ won: true, ms: 90_000, hints: 0, cleared: 100 });
      expect(won.daily.bestTime).toBe(90_000);
      expect(won.daily.bestStreak).toBe(1);
      expect(won.daily.played).toBe(1);
    });

    it('never sets a level’s best time — the opening is free, so a Daily win is not a Medium win', () => {
      const won = clearBoard(openDaily(emptyDailyRecords(), { medium: 600_000 }), 1000, 2000);
      expect(won.game.status).toBe('won');
      expect(won.newBest).toBe(false);
      expect(won.best).toEqual({ medium: 600_000 });
      const fresh = clearBoard(openDaily(), 1000, 2000);
      expect(fresh.best).toEqual({});
    });

    it('records a loss with how far the player got, and the time it ended', () => {
      let session = openDaily();
      session = puzzleReducer(session, play(...safeCell(session), 1000));
      session = puzzleReducer(session, play(...mineCell(session), 9000));
      expect(session.game.status).toBe('lost');
      expect(session.endedAt).toBe(9000);
      expect(session.recorded).toBe(true);
      const result = session.daily.days[DAY]!;
      expect(result).toEqual({ won: false, ms: 8000, hints: 0, cleared: puzzleClearedPercent(session.game) });
      expect(result.cleared).toBeGreaterThan(0);
      expect(result.cleared).toBeLessThan(100);
      expect(session.daily.bestTime).toBeNull();
      expect(session.daily.bestStreak).toBe(0);
      expect(session.daily.played).toBe(1);
    });

    it('counts the hints in the result; a hinted win keeps the streak but sets no best time', () => {
      let session = puzzleReducer(openDaily(), { type: 'hint' });
      session = clearBoard(session, 1000, 61_000);
      expect(session.daily.days[DAY]).toEqual({ won: true, ms: 60_000, hints: 1, cleared: 100 });
      expect(session.daily.bestTime).toBeNull();
      expect(session.daily.bestStreak).toBe(1);
    });

    it('counts for the day it started, even when it ends after midnight', () => {
      // The day is held in the session; the moves carry only a time.
      const lateNight = clearBoard(openDaily(), Date.UTC(2026, 9, 4, 16, 50), Date.UTC(2026, 9, 4, 17, 20));
      expect(lateNight.daily.days[DAY]).toBeDefined();
      expect(lateNight.daily.days[NEXT_DAY]).toBeUndefined();
    });

    it('freezes once over: nothing more changes the result', () => {
      const won = clearBoard(openDaily(), 1000, 2000);
      expect(puzzleReducer(won, { type: 'flag', row: 0, col: 0 })).toBe(won);
      expect(puzzleReducer(won, play(0, 0, 9000))).toBe(won);
    });
  });

  describe('practice', () => {
    const played: DailyRecords = recordDailyResult(emptyDailyRecords(), DAY, {
      won: false,
      ms: 5000,
      hints: 0,
      cleared: 40,
    });

    it('is what a day that already has a first try opens as: the same board, never recorded', () => {
      const session = openDaily(played);
      expect(session.practice).toBe(true);
      expect(session.game).toEqual(dailyPuzzle(DAY));
      const won = clearBoard(session, 1000, 2000);
      expect(won.game.status).toBe('won');
      expect(won.recorded).toBe(false);
      expect(won.daily).toEqual(played);
      expect(won.daily.days[DAY]!.won).toBe(false);
      expect(won.daily.bestTime).toBeNull();
    });

    it('is offered once the first try has ended, on the same board and opening', () => {
      let session = openDaily();
      session = puzzleReducer(session, play(...safeCell(session), 1000));
      session = puzzleReducer(session, play(...mineCell(session), 2000));
      const again = puzzleReducer(session, { type: 'practice' });
      expect(again.practice).toBe(true);
      expect(again.mode).toBe('daily');
      expect(again.day).toBe(DAY);
      expect(again.game).toEqual(dailyPuzzle(DAY));
      expect(again.startedAt).toBeNull();
      expect(again.endedAt).toBeNull();
      expect(again.daily).toEqual(session.daily);
      // And it can be played again and again.
      const lostAgain = puzzleReducer(again, play(...mineCell(again), 3000));
      expect(lostAgain.recorded).toBe(false);
      expect(puzzleReducer(lostAgain, { type: 'practice' }).game).toEqual(dailyPuzzle(DAY));
    });

    it('is not offered while the first try is still open — that would be a free retry', () => {
      let session = openDaily();
      session = puzzleReducer(session, play(...safeCell(session), 1000));
      expect(puzzleReducer(session, { type: 'practice' })).toBe(session);
    });

    it('does nothing outside the Daily', () => {
      const session = startSession('easy', {});
      expect(puzzleReducer(session, { type: 'practice' })).toBe(session);
    });

    it('keeps a result that storage did not have, so leaving and coming back is not a free retry', () => {
      const won = clearBoard(openDaily(), 1000, 2000);
      const back = puzzleReducer(puzzleReducer(won, { type: 'new', level: 'easy' }), {
        type: 'daily',
        key: DAY,
        records: emptyDailyRecords(),
        saved: null,
      });
      expect(back.practice).toBe(true);
      expect(back.daily.days[DAY]).toEqual(won.daily.days[DAY]);
    });

    it('takes a result from storage that this page did not know of — another tab finished first', () => {
      const session = puzzleReducer(startSession('easy', {}), { type: 'daily', key: DAY, records: played, saved: null });
      expect(session.practice).toBe(true);
    });
  });

  describe('coming back after a reload', () => {
    /** A first try with a few moves made: the clock started at t = 1000, one flag, one hint. */
    function underWay(): PuzzleSession {
      let session = openDaily();
      session = puzzleReducer(session, { type: 'hint' });
      session = puzzleReducer(session, play(...safeCell(session), 1000));
      session = puzzleReducer(session, play(...safeCell(session), 2000));
      const mine = session.game.mines.indexOf(true);
      return puzzleReducer(session, { type: 'flag', row: Math.floor(mine / 16), col: mine % 16 });
    }

    it('saves an unfinished first try, once something has happened in it', () => {
      expect(dailyProgress(openDaily())).toBeNull();
      const saved = dailyProgress(underWay())!;
      expect(saved.key).toBe(DAY);
      expect(saved.startedAt).toBe(1000);
      expect(saved.hintsUsed).toBe(1);
      expect(saved.flagged).toHaveLength(1);
    });

    it('saves a hint taken before the first click, so a reload is not a free reset of the hints', () => {
      const hinted = puzzleReducer(openDaily(), { type: 'hint' });
      expect(dailyProgress(hinted)).toMatchObject({ key: DAY, startedAt: null, hintsUsed: 1 });
    });

    it('saves nothing for a level, a practice game or a finished first try', () => {
      expect(dailyProgress(midGame(['..*..', '..*..', '..*..']))).toBeNull();
      const practice = puzzleReducer(openDaily(), { type: 'hint' });
      expect(dailyProgress({ ...practice, practice: true })).toBeNull();
      expect(dailyProgress(clearBoard(openDaily(), 1000, 2000))).toBeNull();
    });

    it('picks the game up where it was, with the clock still counting from the first click', () => {
      const before = underWay();
      const saved = dailyProgress(before)!;
      const after = puzzleReducer(startSession('easy', {}), { type: 'daily', key: DAY, records: emptyDailyRecords(), saved });
      expect(after.practice).toBe(false);
      expect(after.game.open).toEqual(before.game.open);
      expect(after.game.flagged).toEqual(before.game.flagged);
      expect(after.game.hintsUsed).toBe(1);
      expect(after.game.status).toBe('playing');
      expect(after.startedAt).toBe(1000);
      expect(after.endedAt).toBeNull();
      // An hour later it is still the same game, not a new one.
      expect(elapsedMs(after, 1000 + 3_600_000)).toBe(3_600_000);
    });

    it('can be finished after the reload, and then counts as the day’s first try', () => {
      const saved = dailyProgress(underWay())!;
      const after = puzzleReducer(startSession('easy', {}), { type: 'daily', key: DAY, records: emptyDailyRecords(), saved });
      const won = clearBoard(after, 5000, 61_000);
      expect(won.recorded).toBe(true);
      expect(won.daily.days[DAY]).toEqual({ won: true, ms: 60_000, hints: 1, cleared: 100 });
    });

    it('drops a game from an earlier day: it counts as not played', () => {
      const saved = dailyProgress(underWay())!;
      const next = startDailySession(NEXT_DAY, {}, emptyDailyRecords(), saved);
      expect(next.game).toEqual(dailyPuzzle(NEXT_DAY));
      expect(next.startedAt).toBeNull();
      expect(next.practice).toBe(false);
    });

    it('does not bring a game back for a day that already has its result', () => {
      const saved = dailyProgress(underWay())!;
      const records = recordDailyResult(emptyDailyRecords(), DAY, { won: true, ms: 1, hints: 0, cleared: 100 });
      const session = startDailySession(DAY, {}, records, saved);
      expect(session.practice).toBe(true);
      expect(session.game).toEqual(dailyPuzzle(DAY));
      expect(session.startedAt).toBeNull();
    });

    it('starts a fresh board rather than a broken one when the saved game does not fit the day', () => {
      const board = dailyPuzzle(DAY);
      const saved = makeSavedDaily(DAY, { ...board, open: board.mines }, 1000);
      const session = startDailySession(DAY, {}, emptyDailyRecords(), saved);
      expect(session.game).toEqual(board);
      expect(session.startedAt).toBeNull();
    });

    it('is where the page opens when a Daily from today was left unfinished', () => {
      const saved = dailyProgress(underWay())!;
      const session = openingSession({ easy: 7000 }, emptyDailyRecords(), saved, DAY);
      expect(session.mode).toBe('daily');
      expect(session.startedAt).toBe(1000);
      expect(session.best).toEqual({ easy: 7000 });
    });

    it('opens on Easy as ever otherwise: nothing saved, saved from another day, or already played', () => {
      const saved = dailyProgress(underWay())!;
      const played = recordDailyResult(emptyDailyRecords(), DAY, { won: true, ms: 1, hints: 0, cleared: 100 });
      expect(openingSession({}, emptyDailyRecords(), null, DAY).mode).toBe('easy');
      expect(openingSession({}, emptyDailyRecords(), saved, NEXT_DAY).mode).toBe('easy');
      expect(openingSession({}, played, saved, DAY).mode).toBe('easy');
      expect(openingSession({}, emptyDailyRecords(), { ...saved, open: [] }, DAY).mode).toBe('easy');
      expect(openingSession({}, played, null, DAY).daily).toEqual(played);
    });
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

describe('formatMinutes', () => {
  it('shows whole seconds as minutes and seconds', () => {
    expect(formatMinutes(151_000)).toBe('2:31');
    expect(formatMinutes(151_999)).toBe('2:31');
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(9_500)).toBe('0:09');
    expect(formatMinutes(60_000)).toBe('1:00');
    expect(formatMinutes(75 * 60_000 + 3000)).toBe('75:03');
    expect(formatMinutes(-5)).toBe('0:00');
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
