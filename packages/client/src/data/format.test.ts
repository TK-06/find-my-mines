import { describe, expect, it } from 'vitest';
import {
  deltaTone,
  describeBoard,
  eloChangeText,
  eloChangeTone,
  formatDelta,
  mergeLogLines,
  orderSeats,
  presenceLabel,
  relativeTime,
  signOutAfterRemoval,
  winRate,
} from './format.js';
import type { LogLine, RemovalNotice } from '@fmm/shared';

describe('signOutAfterRemoval', () => {
  const notice = (kind: RemovalNotice['kind']): RemovalNotice => ({
    kind,
    by: 'admin',
    byName: null,
    roomId: null,
    roomName: null,
    roomBan: false,
    note: { reasons: ['other'], remark: '' },
  });

  it('signs out a banned account, so logging in again is required', () => {
    expect(signOutAfterRemoval(notice('banned'), false)).toBe(true);
  });

  it('never signs out a banned guest — a sign-out broadcast reloads every other tab', () => {
    expect(signOutAfterRemoval(notice('banned'), true)).toBe(false);
  });

  it('does not sign anyone out for a kick or an ended room', () => {
    expect(signOutAfterRemoval(notice('kicked'), false)).toBe(false);
    expect(signOutAfterRemoval(notice('room-closed'), false)).toBe(false);
  });

  it('does nothing without a notice', () => {
    expect(signOutAfterRemoval(null, false)).toBe(false);
  });
});

describe('eloChangeText / eloChangeTone', () => {
  it('prefixes a gain with a plus', () => {
    expect(eloChangeText(14)).toBe('+14');
    expect(eloChangeTone(14)).toBe('up');
  });

  it('uses a true minus sign (U+2212) for a loss', () => {
    expect(eloChangeText(-9)).toBe('−9');
    expect(eloChangeTone(-9)).toBe('down');
  });

  it('shows no movement as plus-or-minus zero, in the flat tone', () => {
    expect(eloChangeText(0)).toBe('±0');
    expect(eloChangeTone(0)).toBe('flat');
  });
});

describe('mergeLogLines', () => {
  const line = (id: number): LogLine => ({ id, at: id, kind: 'room', text: `#${id}` });
  const ids = (lines: LogLine[]) => lines.map((l) => l.id);

  it('appends new lines in the order they happened', () => {
    expect(ids(mergeLogLines([line(1), line(2)], [line(3)]))).toEqual([1, 2, 3]);
  });

  it('ignores lines it already has, so a backfill after a reconnect does not duplicate', () => {
    expect(ids(mergeLogLines([line(1), line(2)], [line(1), line(2), line(3)]))).toEqual([1, 2, 3]);
  });

  it('keeps only the newest lines once past the limit', () => {
    expect(ids(mergeLogLines([line(1), line(2), line(3)], [line(4)], 3))).toEqual([2, 3, 4]);
  });
});

describe('presenceLabel', () => {
  // Same words as the friends list, so one player never reads two ways.
  it('describes a player on the landing page', () => {
    expect(presenceLabel({ status: 'lobby', roomId: null })).toBe('In the menu');
  });

  it('describes a player in matchmaking', () => {
    expect(presenceLabel({ status: 'queue', roomId: null })).toBe('Looking for a match');
  });

  it('names the room a seated player is waiting in', () => {
    expect(presenceLabel({ status: 'room', roomId: 'ABCD' })).toBe('In room ABCD');
  });

  it('names the room of a live match', () => {
    expect(presenceLabel({ status: 'playing', roomId: 'ABCD' })).toBe('Playing in ABCD');
  });

  it('names the room a spectator is watching', () => {
    expect(presenceLabel({ status: 'watching', roomId: 'WXYZ' })).toBe('Watching WXYZ');
  });
});

describe('winRate', () => {
  it('is 0 with no games rather than NaN', () => {
    expect(winRate(0, 0)).toBe(0);
  });

  it('rounds to a whole percentage', () => {
    expect(winRate(1, 3)).toBe(33);
    expect(winRate(2, 3)).toBe(67);
  });

  it('handles a perfect and a winless record', () => {
    expect(winRate(5, 5)).toBe(100);
    expect(winRate(0, 5)).toBe(0);
  });

  it('never divides by a negative game count', () => {
    expect(winRate(3, -1)).toBe(0);
  });
});

describe('formatDelta', () => {
  it('signs a gain', () => {
    expect(formatDelta(12)).toBe('+12');
  });

  it('keeps the minus on a loss', () => {
    expect(formatDelta(-8)).toBe('-8');
  });

  it('shows a plain zero, not "+0"', () => {
    expect(formatDelta(0)).toBe('0');
  });
});

describe('deltaTone', () => {
  it('maps sign to a tone', () => {
    expect(deltaTone(3)).toBe('up');
    expect(deltaTone(-3)).toBe('down');
    expect(deltaTone(0)).toBe('flat');
  });
});

describe('describeBoard', () => {
  it('describes a full config', () => {
    expect(describeBoard({ rows: 6, cols: 6, mineCount: 11 })).toBe('6×6 · 11 mines');
  });

  it('degrades gracefully on missing data', () => {
    expect(describeBoard(null)).toBe('unknown board');
    expect(describeBoard(undefined)).toBe('unknown board');
    expect(describeBoard({ rows: 6 })).toBe('unknown board');
  });

  it('marks an unknown mine count without breaking', () => {
    expect(describeBoard({ rows: 8, cols: 8 })).toBe('8×8 · ? mines');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-04T12:00:00Z');

  it('collapses anything under a minute to "just now"', () => {
    expect(relativeTime('2026-09-04T11:59:30Z', now)).toBe('just now');
  });

  it('reports minutes, hours, days, months and years', () => {
    expect(relativeTime('2026-09-04T11:30:00Z', now)).toBe('30m ago');
    expect(relativeTime('2026-09-04T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-09-01T12:00:00Z', now)).toBe('3d ago');
    expect(relativeTime('2026-06-04T12:00:00Z', now)).toBe('3mo ago');
    expect(relativeTime('2024-09-04T12:00:00Z', now)).toBe('2y ago');
  });

  it('treats a future timestamp as just now rather than negative', () => {
    expect(relativeTime('2026-09-04T12:05:00Z', now)).toBe('just now');
  });

  it('does not throw on an unparseable date', () => {
    expect(relativeTime('not-a-date', now)).toBe('unknown');
  });
});

describe('orderSeats', () => {
  it('puts the best placement first', () => {
    const ordered = orderSeats([
      { placement: 3, score: 1 },
      { placement: 1, score: 6 },
      { placement: 2, score: 4 },
    ]);
    expect(ordered.map((s) => s.placement)).toEqual([1, 2, 3]);
  });

  it('breaks a shared placement by score', () => {
    const ordered = orderSeats([
      { placement: 1, score: 4 },
      { placement: 1, score: 7 },
    ]);
    expect(ordered.map((s) => s.score)).toEqual([7, 4]);
  });

  it('does not mutate the input', () => {
    const input = [{ placement: 2, score: 1 }, { placement: 1, score: 5 }];
    orderSeats(input);
    expect(input[0]!.placement).toBe(2);
  });
});
