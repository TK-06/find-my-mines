import type { Replay, Review } from '@fmm/shared';
import { useEffect, useState } from 'react';

/** Where the review of a replay has got to. */
export type ReviewStatus =
  /** There is no replay to review (yet). */
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'ready'; review: Review }
  | { phase: 'failed' };

type Runner = typeof import('./reviewRunner.js').reviewRunner;

/**
 * The runner (and the solver it uses) is loaded the first time a game's review
 * is wanted, not with the page: most visits never finish a game, and the
 * result popup and the review screen share the one chunk. Once loaded it is
 * kept here, so a finished review is found at once, with no flash of "analysing".
 */
let loaded: Runner | null = null;

function loadRunner(): Promise<Runner> {
  return import('./reviewRunner.js').then((module) => (loaded = module.reviewRunner));
}

function initial(replay: Replay | null): ReviewStatus {
  if (!replay) return { phase: 'idle' };
  const done = loaded?.cached(replay);
  return done ? { phase: 'ready', review: done } : { phase: 'running', done: 0, total: replay.moves.length };
}

/**
 * The review of a replay, worked out in the background (see reviewRunner) with
 * its progress. The end-of-game popup and the review screen both ask for the
 * same game: whichever asks first starts the work and the other shares it, and
 * a finished review is remembered, so the screen opens already done.
 */
export function useReview(replay: Replay | null): ReviewStatus {
  const [status, setStatus] = useState<ReviewStatus>(() => initial(replay));

  useEffect(() => {
    setStatus(initial(replay));
    if (!replay || loaded?.cached(replay)) return;

    let live = true;
    loadRunner()
      .then((runner) =>
        runner.analyse(replay, (done, total) => {
          if (live) setStatus({ phase: 'running', done, total });
        }),
      )
      .then((review) => {
        if (live) setStatus({ phase: 'ready', review });
      })
      .catch((error: unknown) => {
        console.error('[review] could not analyse the game:', error);
        if (live) setStatus({ phase: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [replay]);

  return status;
}
