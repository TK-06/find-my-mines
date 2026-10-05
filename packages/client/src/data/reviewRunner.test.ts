import { parseCellLabel, parseReplay, reviewMatch, type Replay, type Review } from '@fmm/shared';
import { describe, expect, it, vi } from 'vitest';
import { REVIEW_CACHE_KEEP, analyseInSlices, createReviewRunner, replayKey, type Compute } from './reviewRunner.js';

/** 1 x 5, mines A1 and C1; `first` is the cell the first move opens, so two games can differ. */
function game(first = 'B1'): Replay {
  const at = (label: string) => parseCellLabel(label, 1, 5)!;
  return parseReplay({
    v: 1,
    rows: 1,
    cols: 5,
    mineCount: 2,
    mines: [at('A1'), at('C1')],
    seats: [
      { name: 'Ann', bot: false },
      { name: 'Ben', bot: false },
    ],
    moves: [
      { i: at(first), s: 0 },
      { i: at('A1'), s: 1 },
    ],
  })!;
}

/** A compute whose work the test finishes by hand. */
function manual() {
  const calls: { replay: Replay; progress: (done: number, total: number) => void; finish: (r: Review | null) => void; fail: (e: Error) => void }[] = [];
  const compute: Compute = (replay, progress) =>
    new Promise((resolve, reject) => {
      calls.push({ replay, progress, finish: resolve, fail: reject });
    });
  return { calls, compute };
}

describe('replayKey', () => {
  it('is the same for the same game and different for another', () => {
    expect(replayKey(game())).toBe(replayKey(game()));
    expect(replayKey(game())).not.toBe(replayKey(game('D1')));
  });

  it('tells apart games that differ only in who moved, or in names', () => {
    const a = game();
    const b: Replay = { ...a, moves: a.moves.map((m) => ({ ...m, s: 1 - m.s })) };
    const c: Replay = { ...a, seats: [{ name: 'Ann', bot: false }, { name: 'Bo', bot: false }] };
    expect(new Set([replayKey(a), replayKey(b), replayKey(c)]).size).toBe(3);
  });
});

describe('createReviewRunner', () => {
  it('works a game out once, however many ask while it is under way', async () => {
    const { calls, compute } = manual();
    const runner = createReviewRunner(compute);
    const first = runner.analyse(game());
    const second = runner.analyse(game());

    expect(calls).toHaveLength(1);
    const review = reviewMatch(game());
    calls[0]!.finish(review);
    expect(await first).toBe(review);
    expect(await second).toBe(review);
  });

  it('answers from memory once it has finished', async () => {
    const { calls, compute } = manual();
    const runner = createReviewRunner(compute);
    const pending = runner.analyse(game());
    expect(runner.cached(game())).toBeNull();
    calls[0]!.finish(reviewMatch(game()));
    await pending;

    expect(runner.cached(game())).not.toBeNull();
    expect(await runner.analyse(game())).toBe(runner.cached(game()));
    expect(calls).toHaveLength(1);
  });

  it('gives every asker the progress, and a late one hears where it has got to at once', async () => {
    const { calls, compute } = manual();
    const runner = createReviewRunner(compute);
    const early: [number, number][] = [];
    const late: [number, number][] = [];
    const first = runner.analyse(game(), (d, t) => early.push([d, t]));
    calls[0]!.progress(1, 2);
    const second = runner.analyse(game(), (d, t) => late.push([d, t]));
    calls[0]!.progress(2, 2);
    calls[0]!.finish(reviewMatch(game()));
    await Promise.all([first, second]);

    expect(early).toEqual([[1, 2], [2, 2]]);
    expect(late).toEqual([[1, 2], [2, 2]]);
  });

  it('stops telling an asker once the work is done', async () => {
    const { calls, compute } = manual();
    const runner = createReviewRunner(compute);
    const heard: number[] = [];
    const pending = runner.analyse(game(), (d) => heard.push(d));
    calls[0]!.finish(reviewMatch(game()));
    await pending;
    calls[0]!.progress(9, 9);
    expect(heard).toEqual([]);
  });

  it('keeps two games apart', async () => {
    const { calls, compute } = manual();
    const runner = createReviewRunner(compute);
    void runner.analyse(game());
    void runner.analyse(game('D1'));
    expect(calls).toHaveLength(2);
  });

  it('does not keep a failure: asking again tries again', async () => {
    const { calls, compute } = manual();
    const runner = createReviewRunner(compute);
    const failing = runner.analyse(game());
    calls[0]!.fail(new Error('boom'));
    await expect(failing).rejects.toThrow('boom');

    const again = runner.analyse(game());
    expect(calls).toHaveLength(2);
    calls[1]!.finish(reviewMatch(game()));
    await expect(again).resolves.toBeDefined();
  });

  it('treats a cancelled analysis as a failure, not a review', async () => {
    const { calls, compute } = manual();
    const runner = createReviewRunner(compute);
    const pending = runner.analyse(game());
    calls[0]!.finish(null);
    await expect(pending).rejects.toThrow();
    expect(runner.cached(game())).toBeNull();
  });

  it('keeps only the last few reviews, dropping the one least recently used', async () => {
    const compute: Compute = async (replay) => reviewMatch(replay);
    const runner = createReviewRunner(compute, 2);
    const games = [game('B1'), game('D1'), game('E1')];
    await runner.analyse(games[0]!);
    await runner.analyse(games[1]!);
    // Using the first again makes the second the oldest.
    await runner.analyse(games[0]!);
    await runner.analyse(games[2]!);

    expect(runner.cached(games[0]!)).not.toBeNull();
    expect(runner.cached(games[1]!)).toBeNull();
    expect(runner.cached(games[2]!)).not.toBeNull();
    expect(REVIEW_CACHE_KEEP).toBeGreaterThan(1);
  });
});

describe('analyseInSlices', () => {
  it('gives the same review as working it out in one go, reporting each move', async () => {
    vi.useFakeTimers();
    try {
      const replay = game();
      const seen: [number, number][] = [];
      const pending = analyseInSlices(replay, (done, total) => seen.push([done, total]));
      await vi.runAllTimersAsync();
      expect(await pending).toEqual(reviewMatch(replay));
      expect(seen).toEqual([[1, 2], [2, 2]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
