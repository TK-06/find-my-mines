import { describe, expect, it } from 'vitest';
import { addGuestMatch, parseGuestMatches, type GuestMatch } from './guestHistory.js';

const entry = (matchId: string, at = 1): GuestMatch => ({ matchId, nickname: 'Alice', at });

describe('addGuestMatch', () => {
  it('puts the newest match first', () => {
    const list = addGuestMatch([entry('a')], entry('b', 2));
    expect(list.map((m) => m.matchId)).toEqual(['b', 'a']);
  });

  it('does not list the same match twice', () => {
    const list = addGuestMatch([entry('a'), entry('b')], entry('a', 3));
    expect(list.map((m) => m.matchId)).toEqual(['a', 'b']);
  });

  it('keeps only the newest matches once past the limit', () => {
    const list = addGuestMatch([entry('b'), entry('a')], entry('c'), 2);
    expect(list.map((m) => m.matchId)).toEqual(['c', 'b']);
  });
});

describe('parseGuestMatches', () => {
  it('reads back what was stored', () => {
    expect(parseGuestMatches(JSON.stringify([entry('a')]))).toEqual([entry('a')]);
  });

  it('treats nothing stored as an empty history', () => {
    expect(parseGuestMatches(null)).toEqual([]);
  });

  it('survives corrupted storage instead of crashing the page', () => {
    expect(parseGuestMatches('{not json')).toEqual([]);
    expect(parseGuestMatches('"a string"')).toEqual([]);
  });

  it('drops entries that are not well-formed', () => {
    const raw = JSON.stringify([entry('a'), { matchId: 5 }, null, { nickname: 'x' }]);
    expect(parseGuestMatches(raw)).toEqual([entry('a')]);
  });
});
