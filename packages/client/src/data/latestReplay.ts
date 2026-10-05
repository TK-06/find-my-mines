import type { MatchReplayNotice, Replay, RoomMode } from '@fmm/shared';

/**
 * The replay of the game this tab just finished, kept in memory so its review
 * works with no database at all (and before the match has been saved).
 *
 * Linked to the saved match when `match:recorded` says its id, so the page and
 * the coach can name the game either way.
 */
export interface LatestReplay {
  roomId: string;
  /** What the server holds the replay under, for the coach. */
  replayId: string;
  /** The saved match's id, once the server has told this seat. */
  matchId: string | null;
  replay: Replay;
  /** The server can answer coach questions (it has a Groq key for it). */
  coach: boolean;
  /**
   * How many matches this tab had seen start when the replay arrived. The
   * end-of-game popup shows a replay only if it came after the latest start —
   * the one the popup is about — and not an older game's.
   */
  matchCount: number;
  /** Casual or ranked, as the room said; null if the room is no longer known. */
  mode: RoomMode | null;
  /** Which seat of the replay was this tab's player; null for a spectator. */
  you: number | null;
  /** When it arrived, in epoch milliseconds: shown as the game's date. */
  receivedAt: number;
}

export function latestFromNotice(
  notice: MatchReplayNotice,
  extra: { matchCount: number; mode: RoomMode | null; you: number | null; now: number },
): LatestReplay {
  return {
    roomId: notice.roomId,
    replayId: notice.replayId,
    matchId: notice.matchId,
    replay: notice.replay,
    coach: notice.coach,
    matchCount: extra.matchCount,
    mode: extra.mode,
    you: extra.you,
    receivedAt: extra.now,
  };
}

/**
 * The latest replay with its saved match id filled in. Only a replay that does
 * not have one yet takes it — `match:recorded` is about the match that just
 * ended, and a second one arriving for the same replay changes nothing.
 */
export function withMatchId(latest: LatestReplay | null, matchId: string): LatestReplay | null {
  if (!latest || latest.matchId !== null) return latest;
  return { ...latest, matchId };
}

/**
 * The replay the end-of-game popup is about: the latest one, if it is this
 * room's and came after the most recent match start. Null otherwise.
 */
export function replayForPopup(
  latest: LatestReplay | null,
  roomId: string | null,
  matchCount: number,
): LatestReplay | null {
  return latest && roomId !== null && latest.roomId === roomId && latest.matchCount === matchCount ? latest : null;
}
