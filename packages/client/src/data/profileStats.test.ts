import { describe, expect, it } from 'vitest';
import {
  activityGrid,
  activityLevel,
  bestElo,
  boardLabel,
  dayKey,
  dayStreak,
  formatDay,
  initialOf,
  minesFound,
  opponentsLabel,
  ratingDomain,
  ratingSeries,
  record,
  signed,
  topPercent,
} from './profileStats.js';

/*
 * Every date here is built with the local-time constructor and turned into an
 * ISO string the way Supabase sends it, so the day a match lands on is the same
 * in any timezone the tests run in.
 */
const at = (month: number, day: number, hour = 14, year = 2026) =>
  new Date(year, month - 1, day, hour).toISOString();

/** Monday 28 September 2026. */
const today = new Date(2026, 8, 28, 9, 30);

interface Row {
  created_at: string;
  mode: 'casual' | 'ranked';
  score: number;
  elo_before: number;
  elo_after: number;
  elo_delta: number;
  outcome: 'win' | 'loss' | 'draw';
}

const row = (created_at: string, overrides: Partial<Row> = {}): Row => ({
  created_at,
  mode: 'casual',
  score: 0,
  elo_before: 800,
  elo_after: 800,
  elo_delta: 0,
  outcome: 'loss',
  ...overrides,
});

const ranked = (created_at: string, before: number, after: number): Row =>
  row(created_at, {
    mode: 'ranked',
    elo_before: before,
    elo_after: after,
    elo_delta: after - before,
    outcome: after > before ? 'win' : after < before ? 'loss' : 'draw',
  });

describe('dayKey', () => {
  it('names the local calendar day, zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});

describe('formatDay', () => {
  it('writes day, short month and year', () => {
    expect(formatDay(new Date(2026, 8, 4))).toBe('4 Sep 2026');
    expect(formatDay(new Date(2026, 8, 27))).toBe('27 Sep 2026');
  });
});

describe('activityGrid', () => {
  it('lays out 53 weeks of 7 days, Sunday first', () => {
    const grid = activityGrid([], today);
    expect(grid.weeks).toHaveLength(53);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    expect(grid.weeks[0]![0]!.key).toBe('2025-09-28');
    expect(grid.weeks[0]![0]!.date.getDay()).toBe(0);
  });

  it('ends on the week holding today, with the days after it left empty', () => {
    const last = activityGrid([], today).weeks[52]!;
    expect(last[0]!.key).toBe('2026-09-27');
    expect(last[1]!.key).toBe('2026-09-28');
    expect(last.slice(2)).toEqual([null, null, null, null, null]);
  });

  it('keeps today in the last column whatever weekday it is', () => {
    const saturday = new Date(2026, 9, 3, 12);
    const last = activityGrid([], saturday).weeks[52]!;
    expect(last[6]!.key).toBe('2026-10-03');
    expect(last.every((day) => day !== null)).toBe(true);
  });

  it('counts matches per local day and totals the year', () => {
    const grid = activityGrid(
      [row(at(9, 27, 8)), row(at(9, 27, 22)), row(at(9, 28, 1)), row(at(3, 3))],
      today,
    );
    expect(grid.weeks[52]![0]!.count).toBe(2);
    expect(grid.weeks[52]![1]!.count).toBe(1);
    expect(grid.total).toBe(4);
    expect(grid.max).toBe(2);
  });

  it('ignores matches older than the grid, and future or unreadable timestamps', () => {
    const grid = activityGrid(
      [row(at(9, 1, 12, 2025)), row(at(10, 2)), row('not-a-date')],
      today,
    );
    expect(grid.total).toBe(0);
  });

  it('shades each day relative to the busiest one', () => {
    const grid = activityGrid(
      [...Array.from({ length: 8 }, () => row(at(9, 27))), row(at(9, 28))],
      today,
    );
    expect(grid.weeks[52]![0]!.level).toBe(4);
    expect(grid.weeks[52]![1]!.level).toBe(1);
    expect(grid.weeks[0]![0]!.level).toBe(0);
  });

  it('labels each month over its first week, dropping a first label that would collide', () => {
    const { months } = activityGrid([], today);
    expect(months.map((m) => m.label)).toEqual([
      'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    ]);
    expect(months[0]!.column).toBe(1);
    expect(months.at(-1)!.column).toBe(49);
  });

  it('drops a last label that would run past the final column', () => {
    // Saturday 10 Oct 2026: October's first Sunday is in the very last column.
    const { months } = activityGrid([], new Date(2026, 9, 10));
    expect(months.at(-1)).toEqual({ column: 48, label: 'Sep' });
    for (const month of months) expect(month.column).toBeLessThanOrEqual(50);
  });

  it('keeps the first month label when there is room for it', () => {
    // Sunday 1 Mar 2026 − 52 weeks = Sunday 2 Mar 2025: March has five columns.
    const { months } = activityGrid([], new Date(2026, 2, 3));
    expect(months[0]).toEqual({ column: 0, label: 'Mar' });
    expect(months[1]).toEqual({ column: 5, label: 'Apr' });
  });
});

describe('activityLevel', () => {
  it('is 0 for a day with no matches', () => {
    expect(activityLevel(0, 10)).toBe(0);
  });

  it('spreads counts over four shades up to the busiest day', () => {
    expect(activityLevel(1, 20)).toBe(1);
    expect(activityLevel(10, 20)).toBe(2);
    expect(activityLevel(15, 20)).toBe(3);
    expect(activityLevel(20, 20)).toBe(4);
  });

  it('does not paint one match as the darkest shade just because it is the most', () => {
    expect(activityLevel(1, 1)).toBe(1);
    expect(activityLevel(2, 2)).toBe(2);
  });
});

describe('dayStreak', () => {
  it('counts consecutive days ending today', () => {
    const rows = [row(at(9, 28)), row(at(9, 27)), row(at(9, 26)), row(at(9, 24))];
    expect(dayStreak(rows, today)).toBe(3);
  });

  it('still counts a streak that ended yesterday — today is not over yet', () => {
    expect(dayStreak([row(at(9, 27)), row(at(9, 26))], today)).toBe(2);
  });

  it('is broken by a missed day before yesterday', () => {
    expect(dayStreak([row(at(9, 26)), row(at(9, 25))], today)).toBe(0);
  });

  it('counts a day once however many matches it had', () => {
    expect(dayStreak([row(at(9, 28, 9)), row(at(9, 28, 10))], today)).toBe(1);
  });

  it('crosses a month boundary', () => {
    const rows = [row(at(10, 1)), row(at(9, 30)), row(at(9, 29))];
    expect(dayStreak(rows, new Date(2026, 9, 1, 20))).toBe(3);
  });

  it('is 0 with no matches', () => {
    expect(dayStreak([], today)).toBe(0);
  });
});

describe('ratingSeries', () => {
  it('uses ranked matches only, oldest first, starting from the rating before the first', () => {
    const series = ratingSeries([
      ranked(at(9, 3), 816, 830),
      row(at(9, 2)),
      ranked(at(9, 1), 800, 816),
    ]);
    expect(series.start).toBe(800);
    expect(series.results.map((r) => r.elo)).toEqual([816, 830]);
    expect(series.results.map((r) => r.delta)).toEqual([16, 14]);
    expect(series.total).toBe(2);
  });

  it('keeps only the most recent matches, and starts where the oldest kept one began', () => {
    const rows = Array.from({ length: 35 }, (_, i) => ranked(at(8, i + 1), 800 + i, 801 + i));
    const series = ratingSeries(rows, 30);
    expect(series.results).toHaveLength(30);
    expect(series.start).toBe(805);
    expect(series.results.at(-1)!.elo).toBe(835);
    expect(series.total).toBe(35);
  });

  it('is empty before the first ranked match', () => {
    const series = ratingSeries([row(at(9, 1))]);
    expect(series.results).toEqual([]);
    expect(series.total).toBe(0);
  });
});

describe('ratingDomain', () => {
  it('rounds out to clean gridlines that enclose every point', () => {
    const { lo, hi, ticks } = ratingDomain([800, 1024, 950]);
    expect(ticks).toEqual([800, 900, 1000, 1100]);
    expect(lo).toBe(800);
    expect(hi).toBe(1100);
  });

  it('gives a flat line some room instead of dividing by zero', () => {
    const { lo, hi, ticks } = ratingDomain([800, 800]);
    expect(lo).toBeLessThan(800);
    expect(hi).toBeGreaterThan(800);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  it('only ever uses whole-number steps', () => {
    const { ticks } = ratingDomain([800, 803]);
    for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
  });
});

describe('bestElo', () => {
  it('is the highest rating reached after a ranked match', () => {
    const rows = [ranked(at(9, 1), 800, 840), ranked(at(9, 2), 840, 820)];
    expect(bestElo(rows, 820)).toBe(840);
  });

  it('is the current rating when that is higher', () => {
    expect(bestElo([ranked(at(9, 1), 800, 790)], 850)).toBe(850);
  });

  it('ignores casual matches, whose rating never moved', () => {
    expect(bestElo([row(at(9, 1), { elo_after: 999 })], 800)).toBe(800);
  });
});

describe('minesFound', () => {
  it('adds up your score across every match', () => {
    expect(minesFound([row(at(9, 1), { score: 4 }), row(at(9, 2), { score: 7 })])).toBe(11);
  });

  it('is 0 with no matches', () => {
    expect(minesFound([])).toBe(0);
  });
});

describe('record', () => {
  it('counts results and modes across every match', () => {
    const rows = [
      ranked(at(9, 1), 800, 816),
      row(at(9, 2), { outcome: 'win' }),
      row(at(9, 3), { outcome: 'draw' }),
      row(at(9, 4)),
    ];
    expect(record(rows)).toEqual({ matches: 4, wins: 2, losses: 1, draws: 1, ranked: 1, casual: 3 });
  });
});

describe('topPercent', () => {
  it('rounds up, so the very top is never "top 0%"', () => {
    expect(topPercent(3, 43)).toBe(7);
    expect(topPercent(1, 1000)).toBe(1);
  });

  it('is 100 for last place', () => {
    expect(topPercent(40, 40)).toBe(100);
  });

  it('is null when there is nothing to compare against', () => {
    expect(topPercent(3, 0)).toBeNull();
    expect(topPercent(3, null)).toBeNull();
    expect(topPercent(0, 10)).toBeNull();
  });
});

describe('signed', () => {
  it('marks gains with a plus and losses with a real minus sign', () => {
    expect(signed(224)).toBe('+224');
    expect(signed(-40)).toBe('−40');
    expect(signed(0)).toBe('0');
  });
});

describe('boardLabel', () => {
  it('names the graded board', () => {
    expect(boardLabel({ rows: 6, cols: 6, mineCount: 11 })).toBe('Classic 6×6');
  });

  it('gives any other board its size', () => {
    expect(boardLabel({ rows: 6, cols: 6, mineCount: 9 })).toBe('6×6');
    expect(boardLabel({ rows: 10, cols: 8, mineCount: 20 })).toBe('10×8');
  });

  it('does not break on a missing config', () => {
    expect(boardLabel(null)).toBe('—');
    expect(boardLabel({ rows: 6 })).toBe('—');
  });
});

describe('opponentsLabel', () => {
  it('lists up to two names, then how many more', () => {
    expect(opponentsLabel(['Ann'])).toBe('Ann');
    expect(opponentsLabel(['Ann', 'Bo'])).toBe('Ann, Bo');
    expect(opponentsLabel(['Ann', 'Bo', 'Cy', 'Di'])).toBe('Ann, Bo +2');
  });

  it('shows a dash for nobody', () => {
    expect(opponentsLabel([])).toBe('—');
  });
});

describe('initialOf', () => {
  it('is the first character, capitalised', () => {
    expect(initialOf('mina')).toBe('M');
  });

  it('skips leading spaces and keeps a whole emoji', () => {
    expect(initialOf('  zed')).toBe('Z');
    expect(initialOf('💣bomb')).toBe('💣');
  });

  it('falls back to a question mark', () => {
    expect(initialOf('')).toBe('?');
  });
});
