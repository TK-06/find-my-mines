import { describe, expect, it } from 'vitest';
import {
  MATCH_WINDOW_MAX,
  MATCH_WINDOW_START,
  MATCH_WINDOW_STEP,
  MATCH_WINDOW_STEP_MS,
  canPair,
  eloWindow,
  findPairs,
  type QueueEntry,
} from './matchmaking.js';

const NOW = 1_000_000;

function entry(id: string, elo: number, waitedMs = 0, mode: 'casual' | 'ranked' = 'ranked'): QueueEntry {
  return { id, nickname: id, elo, mode, joinedAt: NOW - waitedMs };
}

describe('eloWindow', () => {
  it('starts at the base tolerance', () => {
    expect(eloWindow(0)).toBe(MATCH_WINDOW_START);
  });

  it('does not widen before a full step has passed', () => {
    expect(eloWindow(MATCH_WINDOW_STEP_MS - 1)).toBe(MATCH_WINDOW_START);
  });

  it('widens one step at a time', () => {
    expect(eloWindow(MATCH_WINDOW_STEP_MS)).toBe(MATCH_WINDOW_START + MATCH_WINDOW_STEP);
    expect(eloWindow(MATCH_WINDOW_STEP_MS * 3)).toBe(MATCH_WINDOW_START + MATCH_WINDOW_STEP * 3);
  });

  it('caps so the window cannot grow without bound', () => {
    expect(eloWindow(MATCH_WINDOW_STEP_MS * 10_000)).toBe(MATCH_WINDOW_MAX);
  });

  it('treats a negative wait as no wait', () => {
    expect(eloWindow(-500)).toBe(MATCH_WINDOW_START);
  });
});

describe('canPair', () => {
  it('pairs two equal ratings immediately', () => {
    expect(canPair(entry('a', 800), entry('b', 800), NOW)).toBe(true);
  });

  it('pairs at exactly the window edge', () => {
    expect(canPair(entry('a', 800), entry('b', 900), NOW)).toBe(true);
  });

  it('refuses one point beyond the window', () => {
    expect(canPair(entry('a', 800), entry('b', 901), NOW)).toBe(false);
  });

  it('never pairs a player with themselves', () => {
    const solo = entry('a', 800);
    expect(canPair(solo, solo, NOW)).toBe(false);
  });

  it('never mixes casual and ranked queues', () => {
    expect(canPair(entry('a', 800, 0, 'casual'), entry('b', 800, 0, 'ranked'), NOW)).toBe(false);
  });

  it('uses the tighter of the two windows, not the wider', () => {
    // 'patient' has waited long enough to accept 300; 'fresh' still wants 100.
    const patient = entry('patient', 800, MATCH_WINDOW_STEP_MS * 4);
    const fresh = entry('fresh', 1050, 0);
    expect(eloWindow(MATCH_WINDOW_STEP_MS * 4)).toBeGreaterThanOrEqual(250);
    expect(canPair(patient, fresh, NOW)).toBe(false);
  });

  it('pairs a wide gap once both have waited', () => {
    const a = entry('a', 800, MATCH_WINDOW_STEP_MS * 6);
    const b = entry('b', 1100, MATCH_WINDOW_STEP_MS * 6);
    expect(canPair(a, b, NOW)).toBe(true);
  });

  it('is symmetric', () => {
    const a = entry('a', 800, 0);
    const b = entry('b', 870, MATCH_WINDOW_STEP_MS * 2);
    expect(canPair(a, b, NOW)).toBe(canPair(b, a, NOW));
  });
});

describe('findPairs', () => {
  it('returns nothing for an empty queue', () => {
    expect(findPairs([], NOW)).toEqual([]);
  });

  it('returns nothing for a single player', () => {
    expect(findPairs([entry('a', 800)], NOW)).toEqual([]);
  });

  it('pairs two compatible players', () => {
    const pairs = findPairs([entry('a', 800), entry('b', 820)], NOW);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.id, pairs[0]!.b.id].sort()).toEqual(['a', 'b']);
  });

  it('leaves incompatible players queued', () => {
    expect(findPairs([entry('a', 400), entry('b', 1600)], NOW)).toEqual([]);
  });

  it('never puts a player in two pairs', () => {
    const pairs = findPairs(
      [entry('a', 800), entry('b', 810), entry('c', 820), entry('d', 830)],
      NOW,
    );
    const ids = pairs.flatMap((p) => [p.a.id, p.b.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pairs four compatible players into two matches', () => {
    const pairs = findPairs(
      [entry('a', 800), entry('b', 810), entry('c', 820), entry('d', 830)],
      NOW,
    );
    expect(pairs).toHaveLength(2);
  });

  it('leaves the odd one out when the count is odd', () => {
    const pairs = findPairs([entry('a', 800), entry('b', 810), entry('c', 820)], NOW);
    expect(pairs).toHaveLength(1);
  });

  it('serves the longest waiter first', () => {
    const veteran = entry('veteran', 800, MATCH_WINDOW_STEP_MS * 2);
    const newcomer = entry('newcomer', 800, 0);
    const other = entry('other', 800, 0);
    const pairs = findPairs([newcomer, veteran, other], NOW);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.id, pairs[0]!.b.id]).toContain('veteran');
  });

  it('gives each player their closest available opponent', () => {
    const pairs = findPairs([entry('a', 800), entry('far', 890), entry('near', 805)], NOW);
    const first = pairs.find((p) => p.a.id === 'a' || p.b.id === 'a')!;
    expect([first.a.id, first.b.id]).toContain('near');
  });

  it('keeps casual and ranked queues separate', () => {
    const pairs = findPairs(
      [
        entry('c1', 800, 0, 'casual'),
        entry('r1', 800, 0, 'ranked'),
        entry('c2', 800, 0, 'casual'),
        entry('r2', 800, 0, 'ranked'),
      ],
      NOW,
    );
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair.a.mode).toBe(pair.b.mode);
      expect(pair.mode).toBe(pair.a.mode);
    }
  });

  it('does not mutate the queue it was given', () => {
    const queue = [entry('b', 810), entry('a', 800)];
    findPairs(queue, NOW);
    expect(queue[0]!.id).toBe('b');
  });
});
