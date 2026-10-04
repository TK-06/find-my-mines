import { dailyPuzzle, shiftDailyKey, type PuzzleGame } from '@fmm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KEEP_DAYS,
  clearSavedDaily,
  currentStreak,
  dailyResultOf,
  emptyDailyRecords,
  loadDailyRecords,
  loadSavedDaily,
  longestStreak,
  makeSavedDaily,
  mergeDailyRecords,
  parseDailyRecords,
  parseSavedDaily,
  recordDailyResult,
  restoreSavedDaily,
  saveDailyRecords,
  saveSavedDaily,
  type DailyRecords,
  type DailyResult,
} from './dailyStore.js';

const win = (ms = 90_000, hints = 0): DailyResult => ({ won: true, ms, hints, cleared: 100 });
const loss = (cleared = 40, ms = 20_000): DailyResult => ({ won: false, ms, hints: 0, cleared });

/** `n` days from the day `from`, as a key. */
const day = (from: string, n: number) => shiftDailyKey(from, n)!;

/** Records with these results already in, as if each had been played in turn. */
function recordsOf(results: Record<string, DailyResult>): DailyRecords {
  return Object.entries(results)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .reduce((records, [key, result]) => recordDailyResult(records, key, result), emptyDailyRecords());
}

describe('recordDailyResult', () => {
  it('records the first try of a day, and counts it', () => {
    const records = recordDailyResult(emptyDailyRecords(), '2026-10-04', win(151_000));
    expect(records.days).toEqual({ '2026-10-04': win(151_000) });
    expect(records.played).toBe(1);
    expect(records.bestTime).toBe(151_000);
    expect(records.bestStreak).toBe(1);
  });

  it('keeps the first try as the result and ignores any later one for the same day', () => {
    const first = recordDailyResult(emptyDailyRecords(), '2026-10-04', loss());
    const second = recordDailyResult(first, '2026-10-04', win());
    expect(second).toBe(first);
    expect(second.days['2026-10-04']).toEqual(loss());
    expect(second.played).toBe(1);
  });

  it('ignores a key that is not a date', () => {
    const records = emptyDailyRecords();
    expect(recordDailyResult(records, 'today', win())).toBe(records);
    expect(recordDailyResult(records, '2026-02-30', win())).toBe(records);
  });

  it('sets the best time only with a hint-free win, and only when faster', () => {
    let records = recordDailyResult(emptyDailyRecords(), '2026-10-04', win(100_000));
    records = recordDailyResult(records, '2026-10-05', win(80_000, 1));
    expect(records.bestTime).toBe(100_000);
    records = recordDailyResult(records, '2026-10-06', loss(70, 10_000));
    expect(records.bestTime).toBe(100_000);
    records = recordDailyResult(records, '2026-10-07', win(120_000));
    expect(records.bestTime).toBe(100_000);
    records = recordDailyResult(records, '2026-10-08', win(95_000));
    expect(records.bestTime).toBe(95_000);
  });

  it('keeps the best streak, even once a loss ends the run', () => {
    let records = emptyDailyRecords();
    for (const key of ['2026-10-04', '2026-10-05', '2026-10-06']) records = recordDailyResult(records, key, win());
    expect(records.bestStreak).toBe(3);
    records = recordDailyResult(records, '2026-10-07', loss());
    records = recordDailyResult(records, '2026-10-08', win());
    expect(records.bestStreak).toBe(3);
  });

  it('drops days past the history kept, without losing the best streak, best time or the count', () => {
    let records = emptyDailyRecords();
    for (let i = 0; i < 5; i++) records = recordDailyResult(records, day('2025-01-01', i), win(30_000 + i));
    expect(records.bestStreak).toBe(5);
    expect(records.bestTime).toBe(30_000);

    // A year and more later: those five days are old history now.
    const later = day('2025-01-01', KEEP_DAYS + 30);
    records = recordDailyResult(records, later, win(200_000));
    expect(Object.keys(records.days)).toEqual([later]);
    expect(records.bestStreak).toBe(5);
    expect(records.bestTime).toBe(30_000);
    expect(records.played).toBe(6);
  });

  it('keeps every day within the history window', () => {
    const newest = '2026-10-04';
    const edge = day(newest, -KEEP_DAYS);
    let records = recordDailyResult(emptyDailyRecords(), edge, win());
    records = recordDailyResult(records, newest, win());
    expect(Object.keys(records.days).sort()).toEqual([edge, newest]);
  });
});

describe('dailyResultOf', () => {
  it('takes the outcome, the time and the hints from a finished game', () => {
    const board = dailyPuzzle('2026-10-04');
    const won: PuzzleGame = { ...board, status: 'won', hintsUsed: 2 };
    expect(dailyResultOf(won, 61_234.6)).toEqual({ won: true, ms: 61_235, hints: 2, cleared: 100 });
    const lost: PuzzleGame = { ...board, status: 'lost', exploded: [board.mines.indexOf(true)] };
    const result = dailyResultOf(lost, 5000);
    expect(result).toMatchObject({ won: false, ms: 5000, hints: 0 });
    expect(result.cleared).toBeGreaterThan(0);
    expect(result.cleared).toBeLessThanOrEqual(99);
  });
});

describe('currentStreak', () => {
  const TODAY = '2026-10-10';

  it('counts the consecutive first-try wins that end today', () => {
    const { days } = recordsOf({ [day(TODAY, -2)]: win(), [day(TODAY, -1)]: win(), [TODAY]: win() });
    expect(currentStreak(days, TODAY)).toBe(3);
  });

  it('keeps yesterday’s streak while today is not played yet', () => {
    const { days } = recordsOf({ [day(TODAY, -3)]: win(), [day(TODAY, -2)]: win(), [day(TODAY, -1)]: win() });
    expect(currentStreak(days, TODAY)).toBe(3);
  });

  it('is zero when yesterday was missed and today is not played yet', () => {
    const { days } = recordsOf({ [day(TODAY, -3)]: win(), [day(TODAY, -2)]: win() });
    expect(currentStreak(days, TODAY)).toBe(0);
  });

  it('is broken by a gap day', () => {
    const { days } = recordsOf({ [day(TODAY, -4)]: win(), [day(TODAY, -3)]: win(), [day(TODAY, -1)]: win(), [TODAY]: win() });
    expect(currentStreak(days, TODAY)).toBe(2);
  });

  it('is broken by a loss — today’s ends it, an earlier one stops the count', () => {
    const lostToday = recordsOf({ [day(TODAY, -2)]: win(), [day(TODAY, -1)]: win(), [TODAY]: loss() }).days;
    expect(currentStreak(lostToday, TODAY)).toBe(0);
    const lostBefore = recordsOf({ [day(TODAY, -3)]: win(), [day(TODAY, -2)]: loss(), [day(TODAY, -1)]: win(), [TODAY]: win() }).days;
    expect(currentStreak(lostBefore, TODAY)).toBe(2);
    const lostYesterday = recordsOf({ [day(TODAY, -2)]: win(), [day(TODAY, -1)]: loss() }).days;
    expect(currentStreak(lostYesterday, TODAY)).toBe(0);
  });

  it('counts a win with hints: the streak is about winning, not about hints', () => {
    const { days } = recordsOf({ [day(TODAY, -1)]: win(60_000, 3), [TODAY]: win(60_000, 1) });
    expect(currentStreak(days, TODAY)).toBe(2);
  });

  it('runs across month and year ends', () => {
    const { days } = recordsOf({ '2026-12-30': win(), '2026-12-31': win(), '2027-01-01': win() });
    expect(currentStreak(days, '2027-01-01')).toBe(3);
    expect(currentStreak(days, '2027-01-02')).toBe(3);
    expect(currentStreak(days, '2027-01-03')).toBe(0);
  });

  it('is zero with nothing played', () => {
    expect(currentStreak({}, TODAY)).toBe(0);
  });
});

describe('longestStreak', () => {
  it('is the longest run of consecutive wins, wherever it is', () => {
    const { days } = recordsOf({
      '2026-10-01': win(),
      '2026-10-02': win(),
      '2026-10-03': loss(),
      '2026-10-04': win(),
      '2026-10-05': win(),
      '2026-10-06': win(),
      '2026-10-08': win(),
    });
    expect(longestStreak(days)).toBe(3);
    expect(longestStreak({})).toBe(0);
    expect(longestStreak(recordsOf({ '2026-10-01': loss() }).days)).toBe(0);
  });
});

describe('parseDailyRecords', () => {
  it('reads back what was stored', () => {
    const records = recordsOf({ '2026-10-04': win(151_000), '2026-10-05': loss(63), '2026-10-06': win(90_000, 2) });
    expect(parseDailyRecords(JSON.stringify(records))).toEqual(records);
  });

  it('treats nothing stored as empty records', () => {
    expect(parseDailyRecords(null)).toEqual(emptyDailyRecords());
    expect(parseDailyRecords('')).toEqual(emptyDailyRecords());
  });

  it('survives corrupted storage instead of crashing the page', () => {
    for (const junk of ['{not json', '[1,2]', 'null', '42', '"text"', '{}', '{"days":5}', '{"days":[]}']) {
      expect(parseDailyRecords(junk)).toEqual(emptyDailyRecords());
    }
  });

  it('skips a day that is not a real date or a real result, keeping the rest', () => {
    const stored = JSON.stringify({
      days: {
        '2026-10-04': win(),
        'not-a-date': win(),
        '2026-02-30': win(),
        '2026-10-05': { won: 'yes', ms: 1, hints: 0, cleared: 100 },
        '2026-10-06': { won: true, ms: -5, hints: 0, cleared: 100 },
        '2026-10-07': { won: true, ms: 'fast', hints: 0, cleared: 100 },
        '2026-10-08': { won: true, ms: 1, hints: 9, cleared: 100 },
        '2026-10-09': { won: false, ms: 1, hints: 0, cleared: 120 },
        '2026-10-10': { won: false, ms: 1, hints: 1.5, cleared: 10 },
        '2026-10-11': null,
        '2026-10-12': loss(),
      },
    });
    // Written into the text by hand: in an object literal, __proto__ would not be a key.
    const raw = stored.replace('"days":{', '"days":{"__proto__":{"won":true,"ms":1,"hints":0,"cleared":100},');
    expect(raw).toContain('"__proto__"');
    expect(Object.keys(parseDailyRecords(raw).days).sort()).toEqual(['2026-10-04', '2026-10-12']);
  });

  it('never reports totals lower than the days show', () => {
    const raw = JSON.stringify({
      days: { '2026-10-04': win(70_000), '2026-10-05': win(80_000), '2026-10-06': win(90_000) },
      bestStreak: 1,
      bestTime: 200_000,
      played: 0,
    });
    const records = parseDailyRecords(raw);
    expect(records.bestStreak).toBe(3);
    expect(records.bestTime).toBe(70_000);
    expect(records.played).toBe(3);
  });

  it('keeps totals that outlast the days — the history was pruned', () => {
    const raw = JSON.stringify({ days: { '2026-10-04': loss() }, bestStreak: 12, bestTime: 45_000, played: 80 });
    const records = parseDailyRecords(raw);
    expect(records.bestStreak).toBe(12);
    expect(records.bestTime).toBe(45_000);
    expect(records.played).toBe(80);
  });

  it('ignores totals that are not numbers', () => {
    const raw = JSON.stringify({ days: {}, bestStreak: 'lots', bestTime: 'fast', played: -3 });
    expect(parseDailyRecords(raw)).toEqual(emptyDailyRecords());
  });

  it('prunes a stored history that has grown past the days kept', () => {
    const days: Record<string, DailyResult> = {};
    for (let i = 0; i < KEEP_DAYS + 100; i++) days[day('2025-01-01', i)] = loss();
    const records = parseDailyRecords(JSON.stringify({ days }));
    expect(Object.keys(records.days)).toHaveLength(KEEP_DAYS + 1);
    expect(records.played).toBe(KEEP_DAYS + 1);
  });
});

describe('mergeDailyRecords', () => {
  it('has every day from either side, and the stored one when both have the same day', () => {
    const stored = recordsOf({ '2026-10-04': loss(), '2026-10-05': win(80_000) });
    const mine = recordsOf({ '2026-10-04': win(60_000), '2026-10-06': win(70_000) });
    const merged = mergeDailyRecords(stored, mine);
    expect(merged.days).toEqual({ '2026-10-04': loss(), '2026-10-05': win(80_000), '2026-10-06': win(70_000) });
    expect(merged.played).toBe(3);
    expect(merged.bestStreak).toBe(2);
  });

  it('keeps the better totals from each side', () => {
    const stored: DailyRecords = { days: {}, bestStreak: 9, bestTime: 50_000, played: 20 };
    const mine: DailyRecords = { days: {}, bestStreak: 4, bestTime: 40_000, played: 30 };
    expect(mergeDailyRecords(stored, mine)).toEqual({ days: {}, bestStreak: 9, bestTime: 40_000, played: 30 });
  });

  it('is unchanged by merging with itself', () => {
    const records = recordsOf({ '2026-10-04': win(), '2026-10-05': loss() });
    expect(mergeDailyRecords(records, records)).toEqual(records);
    expect(mergeDailyRecords(emptyDailyRecords(), emptyDailyRecords())).toEqual(emptyDailyRecords());
  });
});

describe('a saved Daily game', () => {
  const KEY = '2026-10-04';
  const board = dailyPuzzle(KEY);

  /** A game with one more cell opened and one flag, as a player might leave it. */
  function played(): PuzzleGame {
    const next = board.open.findIndex((isOpen, index) => !isOpen && !board.mines[index]);
    const mine = board.mines.indexOf(true);
    const open = [...board.open];
    open[next] = true;
    const flagged = [...board.flagged];
    flagged[mine] = true;
    return { ...board, open, flagged, hintsUsed: 2 };
  }

  it('keeps only what the player changed, and reads back the same', () => {
    const saved = makeSavedDaily(KEY, played(), 123_456);
    expect(saved).toEqual({
      key: KEY,
      startedAt: 123_456,
      hintsUsed: 2,
      open: expect.any(Array),
      flagged: [board.mines.indexOf(true)],
    });
    expect(saved.open).toHaveLength(board.open.filter(Boolean).length + 1);
    expect(parseSavedDaily(JSON.stringify(saved))).toEqual(saved);
    // No mines or numbers in it: the board is rebuilt from the day.
    expect(JSON.stringify(saved)).not.toContain('mines');
    expect(JSON.stringify(saved)).not.toContain('adjacent');
  });

  it('is rebuilt on the day’s board, as it was', () => {
    const game = played();
    const restored = restoreSavedDaily(makeSavedDaily(KEY, game, 123_456))!;
    expect(restored.game).toEqual(game);
    expect(restored.startedAt).toBe(123_456);
    const fresh = restoreSavedDaily(makeSavedDaily(KEY, board, null))!;
    expect(fresh.game).toEqual(board);
    expect(fresh.startedAt).toBeNull();
  });

  it('is refused when it does not fit the day’s board', () => {
    const mine = board.mines.indexOf(true);
    const covered = board.open.findIndex((isOpen, index) => !isOpen && !board.mines[index]);
    const saved = makeSavedDaily(KEY, board, 1000);
    // A mine marked open.
    expect(restoreSavedDaily({ ...saved, open: [...saved.open, mine] })).toBeNull();
    // The opening closed again.
    expect(restoreSavedDaily({ ...saved, open: saved.open.slice(1) })).toBeNull();
    // A flag on an open cell.
    expect(restoreSavedDaily({ ...saved, flagged: [saved.open[0]!] })).toBeNull();
    // Every safe cell open: that is a win, not a game to resume.
    const all = board.mines.flatMap((isMine, index) => (isMine ? [] : [index]));
    expect(restoreSavedDaily({ ...saved, open: all })).toBeNull();
    // And a valid one stays valid.
    expect(restoreSavedDaily({ ...saved, open: [...saved.open, covered] })).not.toBeNull();
  });

  it('reads as nothing from anything that is not a saved game', () => {
    const good = makeSavedDaily(KEY, board, 1000);
    const bad = (change: object) => JSON.stringify({ ...good, ...change });
    expect(parseSavedDaily(null)).toBeNull();
    expect(parseSavedDaily('{not json')).toBeNull();
    expect(parseSavedDaily('[]')).toBeNull();
    expect(parseSavedDaily(bad({ key: 'yesterday' }))).toBeNull();
    expect(parseSavedDaily(bad({ startedAt: 'now' }))).toBeNull();
    expect(parseSavedDaily(bad({ startedAt: -1 }))).toBeNull();
    expect(parseSavedDaily(bad({ hintsUsed: 4 }))).toBeNull();
    expect(parseSavedDaily(bad({ open: 'all' }))).toBeNull();
    expect(parseSavedDaily(bad({ open: [1, 2, 999] }))).toBeNull();
    expect(parseSavedDaily(bad({ open: [1.5] }))).toBeNull();
    expect(parseSavedDaily(bad({ flagged: [-1] }))).toBeNull();
    expect(parseSavedDaily(bad({ open: new Array(300).fill(1) }))).toBeNull();
    expect(parseSavedDaily(bad({ startedAt: null }))).toMatchObject({ startedAt: null });
  });
});

describe('browser storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A stand-in for localStorage that keeps its data where a test can see it. */
  function stubStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, String(value)),
      removeItem: (key: string) => void data.delete(key),
    });
    return data;
  }

  it('saves records and loads them back', () => {
    const data = stubStorage();
    const records = recordsOf({ '2026-10-04': win(151_000) });
    saveDailyRecords(records);
    expect(data.has('fmm.puzzleDaily')).toBe(true);
    expect(loadDailyRecords()).toEqual(records);
  });

  it('merges with what another tab saved meanwhile, rather than overwriting it', () => {
    stubStorage({ 'fmm.puzzleDaily': JSON.stringify(recordsOf({ '2026-10-04': loss() })) });
    saveDailyRecords(recordsOf({ '2026-10-05': win() }));
    const loaded = loadDailyRecords();
    expect(Object.keys(loaded.days).sort()).toEqual(['2026-10-04', '2026-10-05']);
    expect(loaded.played).toBe(2);
  });

  it('loads a saved game from today, and drops one from an earlier day', () => {
    const data = stubStorage();
    const saved = makeSavedDaily('2026-10-04', dailyPuzzle('2026-10-04'), 1000);
    saveSavedDaily(saved);
    expect(loadSavedDaily('2026-10-04')).toEqual(saved);
    expect(loadSavedDaily('2026-10-05')).toBeNull();
    expect(data.has('fmm.puzzleDailyGame')).toBe(false);
  });

  it('clears a saved game', () => {
    const data = stubStorage();
    saveSavedDaily(makeSavedDaily('2026-10-04', dailyPuzzle('2026-10-04'), 1000));
    clearSavedDaily();
    expect(data.has('fmm.puzzleDailyGame')).toBe(false);
  });

  it('plays on when storage throws, as in a private window', () => {
    const refuse = () => {
      throw new Error('storage blocked');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(loadDailyRecords()).toEqual(emptyDailyRecords());
    expect(loadSavedDaily('2026-10-04')).toBeNull();
    expect(() => saveDailyRecords(recordsOf({ '2026-10-04': win() }))).not.toThrow();
    expect(() => saveSavedDaily(makeSavedDaily('2026-10-04', dailyPuzzle('2026-10-04'), 1))).not.toThrow();
    expect(() => clearSavedDaily()).not.toThrow();
  });

  it('plays on when there is no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadDailyRecords()).toEqual(emptyDailyRecords());
    expect(() => clearSavedDaily()).not.toThrow();
  });
});
