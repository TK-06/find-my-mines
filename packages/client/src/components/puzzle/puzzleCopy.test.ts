import { puzzleFromMines, type PuzzleGame } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { emptyDailyRecords, type DailyResult } from '../../data/dailyStore.js';
import { startDailySession, startSession, type PuzzleSession } from '../../data/puzzleStore.js';
import {
  cellAriaLabel,
  countdownText,
  dailyButtonLabel,
  dailyButtonNote,
  dailyLabel,
  dailyResultSummary,
  dailyShareText,
  dailyTodayText,
  daysText,
  minesLeftLabel,
  modeName,
  presetSummary,
  resultText,
} from './puzzleCopy.js';

function session(game: Partial<PuzzleGame>, extra: Partial<PuzzleSession> = {}): PuzzleSession {
  const base = puzzleFromMines(3, 3, [true, false, false, false, false, false, false, false, false]);
  return { ...startSession('easy', {}), game: { ...base, ...game }, startedAt: 1000, endedAt: 42_300, ...extra };
}

describe('cellAriaLabel', () => {
  it('says where the cell is and what it shows', () => {
    expect(cellAriaLabel('covered', 'C4', 0, false)).toBe('C4, covered');
    expect(cellAriaLabel('covered', 'C4', 0, true)).toBe('C4, covered, hinted');
    expect(cellAriaLabel('flagged', 'C4', 0, false)).toBe('C4, flagged');
    expect(cellAriaLabel('open', 'C4', 3, false)).toBe('C4, 3 mines around');
    expect(cellAriaLabel('open', 'C4', 1, false)).toBe('C4, 1 mine around');
    expect(cellAriaLabel('open', 'C4', 0, false)).toBe('C4, no mines around');
  });

  it('names the mines, the one that went off and any wrong flag after a loss', () => {
    expect(cellAriaLabel('mine', 'B2', 0, false)).toBe('B2, mine');
    expect(cellAriaLabel('exploded', 'B2', 0, false)).toBe('B2, mine, exploded');
    expect(cellAriaLabel('wrong-flag', 'B2', 0, false)).toBe('B2, flagged, not a mine');
  });
});

describe('presetSummary', () => {
  it('gives the size as width × height, as the classic menus did', () => {
    expect(presetSummary('easy')).toBe('9 × 9 · 10 mines');
    expect(presetSummary('hard')).toBe('30 × 16 · 99 mines');
  });
});

describe('minesLeftLabel', () => {
  it('reads naturally, including too many flags', () => {
    expect(minesLeftLabel(10)).toBe('10 mines left');
    expect(minesLeftLabel(1)).toBe('1 mine left');
    expect(minesLeftLabel(0)).toBe('0 mines left');
    expect(minesLeftLabel(-2)).toBe('2 more flags than mines');
    expect(minesLeftLabel(-1)).toBe('1 more flag than mines');
  });
});

describe('resultText', () => {
  it('invites the first click', () => {
    expect(resultText(startSession('easy', {}))).toBe('Open any cell to start — the first one is always safe.');
  });

  it('says nothing while the game runs', () => {
    expect(resultText(session({ status: 'playing' }, { endedAt: null }))).toBeNull();
  });

  it('names the mine that ended the game', () => {
    expect(resultText(session({ status: 'lost', exploded: [4] }))).toBe(
      'Boom — B2 was a mine. Start a new game to try again.',
    );
  });

  it('celebrates a new best', () => {
    expect(resultText(session({ status: 'won' }, { newBest: true, best: { easy: 41_300 } }))).toBe(
      'Cleared in 41.3 s — a new best on Easy!',
    );
  });

  it('compares with the best otherwise', () => {
    expect(resultText(session({ status: 'won' }, { best: { easy: 38_000 } }))).toBe(
      'Cleared in 41.3 s. Your best on Easy is 38.0 s.',
    );
  });

  it('marks a win that used hints', () => {
    expect(resultText(session({ status: 'won', hintsUsed: 2 }, { best: { easy: 38_000 } }))).toBe(
      'Cleared in 41.3 s with 2 hints. Games with hints don’t set best times.',
    );
    expect(resultText(session({ status: 'won', hintsUsed: 1 }))).toBe(
      'Cleared in 41.3 s with 1 hint. Games with hints don’t set best times.',
    );
  });
});

const won = (ms: number, hints = 0): DailyResult => ({ won: true, ms, hints, cleared: 100 });
const lost = (cleared: number): DailyResult => ({ won: false, ms: 20_000, hints: 0, cleared });

describe('dailyLabel', () => {
  it('names the day by its number', () => {
    expect(dailyLabel('2026-10-04')).toBe('Daily #1');
    expect(dailyLabel('2026-10-12')).toBe('Daily #9');
  });

  it('drops the number for a day that has none, rather than printing a wrong one', () => {
    expect(dailyLabel('2026-10-03')).toBe('Daily');
    expect(dailyLabel('')).toBe('Daily');
  });
});

describe('the Daily button', () => {
  it('says what the Daily is until it has been played, then how it went', () => {
    expect(dailyButtonNote(undefined)).toBe('16×16 · same for everyone');
    expect(dailyButtonNote(won(151_000))).toBe('✓ 2:31');
    expect(dailyButtonNote(lost(63))).toBe('✗');
  });

  it('is spoken in words, not symbols', () => {
    expect(dailyButtonLabel('2026-10-12', undefined)).toBe('Daily #9, the same board for everyone today');
    expect(dailyButtonLabel('2026-10-12', won(151_000))).toBe('Daily #9, today’s result: cleared in 2:31');
    expect(dailyButtonLabel('2026-10-12', lost(63))).toBe('Daily #9, today’s result: hit a mine');
  });
});

describe('dailyResultSummary and dailyTodayText', () => {
  it('give the time and hints of a win, or how far a loss got', () => {
    expect(dailyResultSummary(won(151_000))).toBe('2:31 · 0 hints');
    expect(dailyResultSummary(won(61_000, 1))).toBe('1:01 · 1 hint');
    expect(dailyResultSummary(won(61_000, 3))).toBe('1:01 · 3 hints');
    expect(dailyResultSummary(lost(63))).toBe('63% cleared');
    expect(dailyTodayText(won(151_000))).toBe('✓ 2:31 · 0 hints');
    expect(dailyTodayText(lost(63))).toBe('✗ 63% cleared');
    expect(dailyTodayText(undefined)).toBe('Not played yet');
  });
});

describe('dailyShareText', () => {
  it('is one line for a win, exactly as agreed', () => {
    expect(dailyShareText('2026-10-12', won(151_000))).toBe(
      'Find My Mines Daily #9 — 2:31 · 0 hints · findmymines.app/puzzle',
    );
    expect(dailyShareText('2026-10-12', won(61_000, 2))).toBe(
      'Find My Mines Daily #9 — 1:01 · 2 hints · findmymines.app/puzzle',
    );
  });

  it('is one line for a loss, with how much was cleared', () => {
    expect(dailyShareText('2026-10-12', lost(63))).toBe('Find My Mines Daily #9 — 💥 63% cleared · findmymines.app/puzzle');
  });

  it('gives away nothing about the board: no cells, no mines', () => {
    for (const result of [won(151_000), lost(63)]) {
      const text = dailyShareText('2026-10-12', result);
      expect(text).not.toMatch(/\b[A-Z]{1,2}\d{1,2}\b/);
      // Past the game's name and address there is no word about mines.
      expect(text.replace('Find My Mines', '').replace('findmymines.app', '')).not.toMatch(/mine/i);
      expect(text.split('\n')).toHaveLength(1);
    }
  });
});

describe('daysText and countdownText', () => {
  it('pluralise days', () => {
    expect(daysText(0)).toBe('0 days');
    expect(daysText(1)).toBe('1 day');
    expect(daysText(12)).toBe('12 days');
  });

  it('show hours and minutes until the next Daily, never "0 m" with time to go', () => {
    expect(countdownText(5 * 3_600_000 + 12 * 60_000)).toBe('5 h 12 m');
    expect(countdownText(5 * 3_600_000)).toBe('5 h 0 m');
    expect(countdownText(42 * 60_000)).toBe('42 m');
    expect(countdownText(42 * 60_000 + 1)).toBe('43 m');
    expect(countdownText(1)).toBe('1 m');
    expect(countdownText(0)).toBe('1 m');
    expect(countdownText(24 * 3_600_000)).toBe('24 h 0 m');
  });
});

describe('the Daily’s result line', () => {
  const KEY = '2026-10-04';
  const fresh = startDailySession(KEY, {}, emptyDailyRecords(), null);
  const over = (game: Partial<PuzzleGame>, extra: Partial<PuzzleSession> = {}): PuzzleSession => ({
    ...fresh,
    game: { ...fresh.game, ...game },
    startedAt: 1000,
    endedAt: 152_000,
    ...extra,
  });

  it('names the mode as the Daily with its number', () => {
    expect(modeName(fresh)).toBe('Daily #1');
    expect(modeName(startSession('medium', {}))).toBe('Medium');
  });

  it('explains the shared opening and the clock before the first click, then goes quiet', () => {
    expect(resultText(fresh)).toBe('Daily #1: everyone gets this same opening. The clock starts at your first click.');
    expect(resultText({ ...fresh, startedAt: 1000 })).toBeNull();
  });

  it('gives a first-try win with its time', () => {
    expect(resultText(over({ status: 'won' }))).toBe('Daily #1 cleared in 2:31 with no hints.');
  });

  it('says a hinted win keeps the streak but not the best time', () => {
    expect(resultText(over({ status: 'won', hintsUsed: 2 }))).toBe(
      'Daily #1 cleared in 2:31 with 2 hints. A win with hints keeps your streak but doesn’t set a best time.',
    );
  });

  it('gives a first-try loss as the day’s result, with how far it got', () => {
    // 19 of the 216 safe cells were open at the start; D2 is cell 19.
    expect(resultText(over({ status: 'lost', exploded: [19] }))).toBe(
      'Boom — D2 was a mine. That is your Daily #1 result: 8% cleared.',
    );
  });

  it('marks every practice game as practice, and not recorded', () => {
    const practice = { practice: true } as const;
    expect(resultText({ ...fresh, practice: true })).toBe(
      'Practice — the same board as the Daily. It won’t change your result, streak or best time.',
    );
    expect(resultText(over({ status: 'won' }, practice))).toBe('Practice: cleared in 2:31. Not recorded.');
    expect(resultText(over({ status: 'won', hintsUsed: 1 }, practice))).toBe(
      'Practice: cleared in 2:31 with 1 hint. Not recorded.',
    );
    expect(resultText(over({ status: 'lost', exploded: [19] }, practice))).toBe(
      'Practice: boom — D2 was a mine. Not recorded.',
    );
  });
});
