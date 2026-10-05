import { reviewMatchAsync, timeSlicedPause, type Replay, type Review } from '@fmm/shared';

/**
 * Runs the review of a replay without freezing the page, and remembers it.
 *
 * Working out a review is one solver call per move: well under a millisecond
 * for most moves, up to ~20 ms for one on a crowded 16 × 16 board, so a long
 * game can add up to most of a second. It runs on the page's own thread, in
 * stretches of about 10 ms with a hand-back to the browser between them, and
 * reports progress as it goes — so a click, a scroll or a keypress is never
 * waiting on it, and no Web Worker (and the bundling that comes with one) is
 * needed. The end-of-game popup and the review screen ask for the same game, so
 * the first to ask starts the work and the other shares it.
 */

export type Progress = (done: number, total: number) => void;

/** How a review is worked out. Passed in so the cache can be tested without a solver. */
export type Compute = (replay: Replay, onProgress: Progress) => Promise<Review | null>;

/** Most finished reviews kept. Each holds an odds grid per move, so this stays small. */
export const REVIEW_CACHE_KEEP = 6;

/** What makes one game the same game as another: its board, mines, seats and moves. */
export function replayKey(replay: Replay): string {
  return [
    `${replay.rows}x${replay.cols}`,
    replay.mines.join(','),
    replay.moves.map((move) => `${move.i}.${move.s}`).join(','),
    replay.seats.map((seat) => `${seat.bot ? 'b' : 'p'}${seat.name}`).join('|'),
  ].join('/');
}

/** Lets the browser run (paint, handle input) before the next stretch of work. */
const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The real thing: the review in short stretches, yielding to the browser between them. */
export const analyseInSlices: Compute = (replay, onProgress) =>
  reviewMatchAsync(replay, {
    pause: timeSlicedPause(yieldToBrowser, () => performance.now()),
    onProgress,
  });

export interface ReviewRunner {
  /**
   * The review of this game: straight from memory if it has been done, shared
   * with the work already under way if it has been started, else started now.
   * `onProgress` hears how far along it is until it finishes. Rejects if it fails.
   */
  analyse(replay: Replay, onProgress?: Progress): Promise<Review>;
  /** The finished review, or null if there is none yet. Never starts any work. */
  cached(replay: Replay): Review | null;
}

interface Job {
  promise: Promise<Review>;
  listeners: Set<Progress>;
  last: { done: number; total: number } | null;
}

export function createReviewRunner(compute: Compute = analyseInSlices, keep = REVIEW_CACHE_KEEP): ReviewRunner {
  /** Oldest first: a Map iterates in insertion order and a use re-inserts. */
  const finished = new Map<string, Review>();
  const running = new Map<string, Job>();

  return {
    cached(replay) {
      return finished.get(replayKey(replay)) ?? null;
    },

    analyse(replay, onProgress) {
      const key = replayKey(replay);

      const done = finished.get(key);
      if (done) {
        finished.delete(key);
        finished.set(key, done);
        return Promise.resolve(done);
      }

      let job = running.get(key);
      if (!job) {
        const fresh: Job = { promise: undefined as unknown as Promise<Review>, listeners: new Set(), last: null };
        fresh.promise = compute(replay, (doneMoves, total) => {
          fresh.last = { done: doneMoves, total };
          for (const listener of fresh.listeners) listener(doneMoves, total);
        }).then(
          (review) => {
            running.delete(key);
            if (!review) throw new Error('The review was cancelled.');
            finished.set(key, review);
            while (finished.size > keep) finished.delete(finished.keys().next().value!);
            return review;
          },
          (error: unknown) => {
            // Not cached: opening the page again tries again.
            running.delete(key);
            throw error;
          },
        );
        running.set(key, fresh);
        job = fresh;
      }

      if (onProgress) {
        job.listeners.add(onProgress);
        // Whoever joins late is told where it has got to straight away.
        if (job.last) onProgress(job.last.done, job.last.total);
        const listeners = job.listeners;
        const forget = () => listeners.delete(onProgress);
        void job.promise.then(forget, forget);
      }
      return job.promise;
    },
  };
}

/** The one the app uses: the popup and the review screen share it. */
export const reviewRunner: ReviewRunner = createReviewRunner();
