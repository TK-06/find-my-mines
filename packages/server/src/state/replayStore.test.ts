import type { Replay } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { REPLAY_KEEP, REPLAY_TTL_MS, ReplayStore } from './replayStore.js';

const replay = (tag: number): Replay => ({
  v: 1,
  rows: 3,
  cols: 3,
  mineCount: 1,
  mines: [tag % 9],
  seats: [
    { name: 'Ann', bot: false },
    { name: 'Ben', bot: false },
  ],
  moves: [],
});

/** A store whose ids are r1, r2, … so a test can name them. */
function store(keep = 3, ttl = 1_000): ReplayStore {
  let n = 0;
  return new ReplayStore(keep, ttl, () => `r${++n}`);
}

describe('ReplayStore', () => {
  it('keeps 200 replays for two hours by default', () => {
    expect(REPLAY_KEEP).toBe(200);
    expect(REPLAY_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('hands back what it was given, under a fresh random id', () => {
    const s = new ReplayStore();
    const a = s.add(replay(1), 0);
    const b = s.add(replay(2), 0);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.get(a, 1)?.replay).toEqual(replay(1));
    expect(s.get(a, 1)?.matchId).toBeNull();
  });

  it('knows nothing of an id it never gave out', () => {
    expect(store().get('nope', 0)).toBeUndefined();
    expect(store().getByMatch('nope', 0)).toBeUndefined();
  });

  it('drops the least recently used replay when full', () => {
    const s = store(3);
    const ids = [1, 2, 3].map((n) => s.add(replay(n), n));
    // Using the oldest makes it the newest, so the second-oldest goes next.
    expect(s.get(ids[0]!, 10)).toBeDefined();
    s.add(replay(4), 11);
    expect(s.get(ids[1]!, 12)).toBeUndefined();
    expect(s.get(ids[0]!, 12)).toBeDefined();
    expect(s.get(ids[2]!, 12)).toBeDefined();
    expect(s.size).toBe(3);
  });

  it('forgets a replay nobody has used for the whole time to live', () => {
    const s = store(10, 1_000);
    const id = s.add(replay(1), 0);
    expect(s.get(id, 1_000)).toBeDefined(); // exactly at the limit: still there
    expect(s.get(id, 2_001)).toBeUndefined();
    expect(s.size).toBe(0);
  });

  it('counts a use as fresh, so a replay still being asked about stays', () => {
    const s = store(10, 1_000);
    const id = s.add(replay(1), 0);
    expect(s.get(id, 900)).toBeDefined();
    expect(s.get(id, 1_800)).toBeDefined();
    expect(s.get(id, 2_700)).toBeDefined();
    expect(s.get(id, 3_800)).toBeUndefined();
  });

  it('forgets the old ones when a new one comes, so a quiet store does not hold on forever', () => {
    const s = store(10, 1_000);
    s.add(replay(1), 0);
    s.add(replay(2), 0);
    s.add(replay(3), 5_000);
    expect(s.size).toBe(1);
  });

  it('finds a replay by the saved match it became, once linked', () => {
    const s = store();
    const id = s.add(replay(1), 0);
    expect(s.getByMatch('m1', 1)).toBeUndefined();
    expect(s.link(id, 'm1')).toBe(true);
    expect(s.getByMatch('m1', 2)?.id).toBe(id);
    expect(s.get(id, 3)?.matchId).toBe('m1');
  });

  it('can be given its match id up front, for a replay loaded from the database', () => {
    const s = store();
    const id = s.add(replay(1), 0, 'm9');
    expect(s.getByMatch('m9', 1)?.id).toBe(id);
  });

  it('cannot link a replay it no longer has', () => {
    const s = store(1);
    const old = s.add(replay(1), 0);
    s.add(replay(2), 1);
    expect(s.link(old, 'm1')).toBe(false);
    expect(s.getByMatch('m1', 2)).toBeUndefined();
  });

  it('forgets the match id with the replay', () => {
    const s = store(1);
    const id = s.add(replay(1), 0);
    s.link(id, 'm1');
    s.add(replay(2), 1);
    expect(s.getByMatch('m1', 2)).toBeUndefined();
  });
});
