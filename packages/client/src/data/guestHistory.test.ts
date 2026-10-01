import { describe, expect, it } from 'vitest';
import { addGuestMatch, parseGuestMatches, pruneGuestMatches, type GuestMatch } from './guestHistory.js';
import { GUEST_KEEP_MS } from './guestCookie.js';

const NOW = 1_800_000_000_000;
const entry = (matchId: string, at = NOW): GuestMatch => ({ matchId, nickname: 'Alice', at });

describe('addGuestMatch', () => {
  it('puts the newest match first', () => {
    const list = addGuestMatch([entry('a')], entry('b', NOW + 2), 50, NOW + 2);
    expect(list.map((m) => m.matchId)).toEqual(['b', 'a']);
  });

  it('does not list the same match twice', () => {
    const list = addGuestMatch([entry('a'), entry('b')], entry('a', NOW + 3), 50, NOW + 3);
    expect(list.map((m) => m.matchId)).toEqual(['a', 'b']);
  });

  it('keeps only the newest matches once past the limit', () => {
    const list = addGuestMatch([entry('b'), entry('a')], entry('c'), 2, NOW);
    expect(list.map((m) => m.matchId)).toEqual(['c', 'b']);
  });
});

describe('parseGuestMatches', () => {
  it('reads back what was stored', () => {
    expect(parseGuestMatches(JSON.stringify([entry('a')]), NOW)).toEqual([entry('a')]);
  });

  it('treats nothing stored as an empty history', () => {
    expect(parseGuestMatches(null, NOW)).toEqual([]);
  });

  it('survives corrupted storage instead of crashing the page', () => {
    expect(parseGuestMatches('{not json', NOW)).toEqual([]);
    expect(parseGuestMatches('"a string"', NOW)).toEqual([]);
  });

  it('drops entries that are not well-formed', () => {
    const raw = JSON.stringify([entry('a'), { matchId: 5 }, null, { nickname: 'x' }]);
    expect(parseGuestMatches(raw, NOW)).toEqual([entry('a')]);
  });
});

describe('30-day expiry', () => {
  const old = (matchId: string) => entry(matchId, NOW - GUEST_KEEP_MS - 1);

  it('keeps an entry exactly 30 days old and drops one a millisecond older', () => {
    const edge = entry('edge', NOW - GUEST_KEEP_MS);
    expect(pruneGuestMatches([edge, old('stale'), entry('fresh')], NOW).map((m) => m.matchId)).toEqual(['edge', 'fresh']);
  });

  it('drops old entries when reading stored history', () => {
    const raw = JSON.stringify([entry('a'), old('b')]);
    expect(parseGuestMatches(raw, NOW).map((m) => m.matchId)).toEqual(['a']);
  });

  it('drops old entries when adding a new one, so they do not come back', () => {
    const list = addGuestMatch([entry('a'), old('b')], entry('c'), 50, NOW);
    expect(list.map((m) => m.matchId)).toEqual(['c', 'a']);
  });
});
