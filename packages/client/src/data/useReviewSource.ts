import type { Replay, RoomMode } from '@fmm/shared';
import { useEffect, useMemo, useState } from 'react';
import type { LatestReplay } from './latestReplay.js';
import { currentUserId, fetchMatchesByIds, fetchReplay } from './queries.js';
import { seatOfProfile } from './reviewModel.js';
import type { ReviewTarget } from '../router.js';

/** Everything the review page needs to know about the game it shows, whichever way it was found. */
export interface ReviewSource {
  replay: Replay;
  /** Which seat was this viewer's; null for a spectator, a guest looking at a saved game, someone else's game. */
  you: number | null;
  mode: RoomMode | null;
  /** When the game was played, as far as known. */
  when: Date | null;
  /** The ids the coach is asked about it by. */
  game: { replayId?: string | null; matchId?: string | null };
  /**
   * The server said the coach is on when this game ended (true or false); null
   * for a saved game, where nothing has said yet.
   */
  coachHint: boolean | null;
}

/**
 * Where the page stands in finding its game:
 *  loading    asking the database for a saved game;
 *  ready      found;
 *  no-latest  `/review/latest` with no game finished in this tab;
 *  none       a saved game with no replay (an older game, or the database has no column yet);
 *  off        no database is configured, so a saved game cannot be read;
 *  error      the read failed.
 */
export type SourceState =
  | { status: 'loading' }
  | { status: 'ready'; source: ReviewSource }
  | { status: 'no-latest' | 'none' | 'off' | 'error' };

function fromLatest(latest: LatestReplay): ReviewSource {
  return {
    replay: latest.replay,
    you: latest.you,
    mode: latest.mode,
    when: new Date(latest.receivedAt),
    game: { replayId: latest.replayId, matchId: latest.matchId },
    coachHint: latest.coach,
  };
}

/**
 * Finds the game a review path names: the one just played, from this tab's
 * memory (which needs no database), or a saved one — from memory too when it is
 * the game just played, else read from Supabase with the anon key.
 */
export function useReviewSource(target: ReviewTarget, latest: LatestReplay | null): SourceState {
  // A saved game that is also the one just played is already in memory, with its replay id.
  const inMemory = target === 'latest' ? latest : latest?.matchId === target ? latest : null;
  const memorySource = useMemo(() => (inMemory ? fromLatest(inMemory) : null), [inMemory]);

  const [fetched, setFetched] = useState<SourceState>({ status: 'loading' });

  useEffect(() => {
    if (target === 'latest' || memorySource) return;
    let live = true;
    setFetched({ status: 'loading' });
    void (async () => {
      const [loaded, matches, userId] = await Promise.all([fetchReplay(target), fetchMatchesByIds([target]), currentUserId()]);
      if (!live) return;
      if (loaded.status !== 'ok') {
        setFetched({ status: loaded.status });
        return;
      }
      const match = matches[0];
      setFetched({
        status: 'ready',
        source: {
          replay: loaded.replay,
          you: match ? seatOfProfile(loaded.replay, match.players, userId) : null,
          mode: match?.mode ?? null,
          when: match ? new Date(match.created_at) : null,
          game: { matchId: target },
          coachHint: null,
        },
      });
    })();
    return () => {
      live = false;
    };
  }, [target, memorySource]);

  if (memorySource) return { status: 'ready', source: memorySource };
  if (target === 'latest') return { status: 'no-latest' };
  return fetched;
}
