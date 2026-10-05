import { isMatchId, type Replay, type ReviewRef } from '@fmm/shared';
import type { ReplayStore, StoredReplay } from './replayStore.js';

/** The longest replay id taken seriously: ours are 36 characters. */
const REPLAY_ID_MAX = 64;

/**
 * Which finished game a review request names, read defensively from whatever
 * the client sent. Only well-formed ids survive: a replay id is a short string,
 * a match id must look like one, so nothing odd ever reaches the store or the
 * database. Null when it names no game at all.
 */
export function reviewRefOf(payload: unknown): ReviewRef | null {
  const field = (name: string): unknown => (payload as Record<string, unknown> | null | undefined)?.[name];
  const replayId = field('replayId');
  const matchId = field('matchId');

  const ref: ReviewRef = {};
  if (typeof replayId === 'string' && replayId.length > 0 && replayId.length <= REPLAY_ID_MAX) {
    ref.replayId = replayId;
  }
  if (isMatchId(matchId)) ref.matchId = matchId;
  return ref.replayId !== undefined || ref.matchId !== undefined ? ref : null;
}

/** A game the coach may be asked about. */
export interface FoundGame {
  replay: Replay;
  /**
   * What the question allowance is counted under: the saved match's id once the
   * server knows it, otherwise the replay's own id. Read again each time, since
   * the match id can arrive between two questions.
   */
  key(): string;
}

/**
 * The server's own copy of a game: from memory by replay id or by match id,
 * else from the database by match id (and kept in memory from then on). The
 * replay is never taken from the client — an id is all it may send.
 *
 * A replay id and the match id it was later saved under lead to the same entry,
 * so they are one game. `load` reads a saved match's replay; it may be slow.
 */
export async function findGame(
  ref: ReviewRef,
  store: ReplayStore,
  load: (matchId: string) => Promise<Replay | null>,
  now: () => number,
): Promise<FoundGame | null> {
  const found = (entry: StoredReplay): FoundGame => ({
    replay: entry.replay,
    // The entry itself, not a copy: linking it to its match changes the key.
    key: () => entry.matchId ?? entry.id,
  });

  if (ref.replayId !== undefined) {
    const entry = store.get(ref.replayId, now());
    if (entry) return found(entry);
  }

  if (ref.matchId !== undefined) {
    const held = store.getByMatch(ref.matchId, now());
    if (held) return found(held);

    const replay = await load(ref.matchId);
    if (!replay) return null;
    // Another question may have loaded the same match while this one waited.
    const raced = store.getByMatch(ref.matchId, now());
    if (raced) return found(raced);
    return found(store.get(store.add(replay, now(), ref.matchId), now())!);
  }

  return null;
}
