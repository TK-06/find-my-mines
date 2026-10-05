import type { Replay } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { findGame, reviewRefOf } from './gameLookup.js';
import { ReplayStore } from './replayStore.js';

const MATCH = '6a2b1f2e-0000-4000-8000-000000000001';

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

describe('reviewRefOf', () => {
  it('reads a replay id, a match id, or both', () => {
    expect(reviewRefOf({ replayId: 'abc' })).toEqual({ replayId: 'abc' });
    expect(reviewRefOf({ matchId: MATCH })).toEqual({ matchId: MATCH });
    expect(reviewRefOf({ replayId: 'abc', matchId: MATCH })).toEqual({ replayId: 'abc', matchId: MATCH });
  });

  it('names no game for anything else — junk never gets as far as a lookup', () => {
    for (const bad of [undefined, null, 7, 'text', [], {}, { replayId: '' }, { replayId: 7 }, { replayId: {} }, { matchId: 'latest' }, { matchId: "x' or 1=1" }, { matchId: [] }]) {
      expect(reviewRefOf(bad)).toBeNull();
    }
  });

  it('drops an overlong replay id and a malformed match id, keeping the good half', () => {
    expect(reviewRefOf({ replayId: 'x'.repeat(65), matchId: MATCH })).toEqual({ matchId: MATCH });
    expect(reviewRefOf({ replayId: 'abc', matchId: 'nope' })).toEqual({ replayId: 'abc' });
  });

  it('ignores everything else in the payload, a replay included', () => {
    expect(reviewRefOf({ replayId: 'abc', replay: replay(1), question: 'x' })).toEqual({ replayId: 'abc' });
  });
});

describe('findGame', () => {
  const never = async () => {
    throw new Error('the database should not be asked');
  };

  it('finds a game in memory by its replay id, without the database', async () => {
    const store = new ReplayStore();
    const id = store.add(replay(1), 0);
    const game = await findGame({ replayId: id }, store, never, () => 1);
    expect(game?.replay).toEqual(replay(1));
    expect(game?.key()).toBe(id);
  });

  it('finds the same game by the match id it was saved under', async () => {
    const store = new ReplayStore();
    const id = store.add(replay(1), 0);
    store.link(id, MATCH);
    const game = await findGame({ matchId: MATCH }, store, never, () => 1);
    expect(game?.replay).toEqual(replay(1));
    expect(game?.key()).toBe(MATCH);
  });

  it('counts a game under its match id from the moment the server learns it — one game, two ids', async () => {
    const store = new ReplayStore();
    const id = store.add(replay(1), 0);
    const game = (await findGame({ replayId: id }, store, never, () => 1))!;
    expect(game.key()).toBe(id);
    store.link(id, MATCH);
    // The same FoundGame, read again, now says the match id.
    expect(game.key()).toBe(MATCH);
    // And a fresh lookup by either id agrees.
    expect((await findGame({ replayId: id }, store, never, () => 2))!.key()).toBe(MATCH);
    expect((await findGame({ matchId: MATCH }, store, never, () => 2))!.key()).toBe(MATCH);
  });

  it('loads a game it does not hold from the database by match id, and holds it from then on', async () => {
    const store = new ReplayStore();
    let loads = 0;
    const load = async () => {
      loads++;
      return replay(2);
    };
    const first = await findGame({ matchId: MATCH }, store, load, () => 1);
    expect(first?.replay).toEqual(replay(2));
    expect(first?.key()).toBe(MATCH);
    await findGame({ matchId: MATCH }, store, load, () => 2);
    expect(loads).toBe(1);
  });

  it('is null for a match the database has no replay for', async () => {
    expect(await findGame({ matchId: MATCH }, new ReplayStore(), async () => null, () => 1)).toBeNull();
  });

  it('is null for a replay id it never gave out, and does not fall back on a bad claim', async () => {
    expect(await findGame({ replayId: 'nope' }, new ReplayStore(), never, () => 1)).toBeNull();
  });

  it('prefers its own copy by replay id over whatever a client says the match is', async () => {
    const store = new ReplayStore();
    const id = store.add(replay(1), 0);
    // The client names a match too; the server does not link them on its say-so and does not load anything.
    const game = await findGame({ replayId: id, matchId: MATCH }, store, never, () => 1);
    expect(game?.replay).toEqual(replay(1));
    expect(game?.key()).toBe(id);
  });

  it('falls back to the match id when the replay id has expired', async () => {
    const store = new ReplayStore(10, 1_000);
    const id = store.add(replay(1), 0);
    const game = await findGame({ replayId: id, matchId: MATCH }, store, async () => replay(3), () => 5_000);
    expect(game?.replay).toEqual(replay(3));
    expect(game?.key()).toBe(MATCH);
  });

  it('uses one entry when two questions load the same match at once', async () => {
    const store = new ReplayStore();
    const load = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return replay(2);
    };
    const [a, b] = await Promise.all([
      findGame({ matchId: MATCH }, store, load, () => 1),
      findGame({ matchId: MATCH }, store, load, () => 1),
    ]);
    expect(a?.key()).toBe(MATCH);
    expect(b?.key()).toBe(MATCH);
    expect(store.size).toBe(1);
  });
});
