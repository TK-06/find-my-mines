import { formatDelta } from './format.js';

/**
 * How you have done against one particular player, for the "You vs …" block on
 * their player card.
 *
 * Pure: it is handed seat rows (`fetchSeatRecords` reads them) and works the
 * record out, so every rule below is unit-tested with no database.
 */

/** One player's seat in one saved match — the fields the record needs. */
export interface SeatRecord {
  matchId: string;
  /** The seat's account; null for a guest, who can never be "you" or "them". */
  profileId: string | null;
  mode: 'casual' | 'ranked';
  outcome: 'win' | 'loss' | 'draw';
  /** The seat's rating change from the match (0 in a casual one). */
  eloDelta: number;
}

/** Your record against one player, from your side of every match you shared. */
export interface HeadToHead {
  /** Matches you were both seated in. */
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** How many of those were ranked. */
  rankedGames: number;
  /** Your own rating change summed over the ranked ones; casual matches move nobody. */
  netElo: number;
}

/** Nothing played together yet. */
export const NO_HEAD_TO_HEAD: HeadToHead = {
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  rankedGames: 0,
  netElo: 0,
};

/**
 * The record of `viewerId` against `otherId`, from seat rows of either or both
 * of them.
 *
 * Only matches with both of them in it count — a match either one played
 * against somebody else says nothing about the two of them. Each shared match
 * is read from the viewer's seat: their outcome, and (for a ranked one) their
 * rating change. Rows for other players, guests and the like are ignored, and
 * a match listed twice (the same seat read by both sides) counts once.
 */
export function headToHead(
  seats: readonly SeatRecord[],
  viewerId: string,
  otherId: string,
): HeadToHead {
  // You cannot play yourself; a "record against yourself" would be the same seats twice.
  if (!viewerId || !otherId || viewerId === otherId) return NO_HEAD_TO_HEAD;

  const byMatch = new Map<string, { mine?: SeatRecord; theirs: boolean }>();
  for (const seat of seats) {
    if (seat.profileId !== viewerId && seat.profileId !== otherId) continue;
    const entry = byMatch.get(seat.matchId) ?? { theirs: false };
    if (seat.profileId === viewerId) entry.mine ??= seat;
    else entry.theirs = true;
    byMatch.set(seat.matchId, entry);
  }

  const record = { ...NO_HEAD_TO_HEAD };
  for (const { mine, theirs } of byMatch.values()) {
    if (!mine || !theirs) continue;
    record.games += 1;
    if (mine.outcome === 'win') record.wins += 1;
    else if (mine.outcome === 'loss') record.losses += 1;
    else record.draws += 1;
    if (mine.mode === 'ranked') {
      record.rankedGames += 1;
      record.netElo += mine.eloDelta;
    }
  }
  return record;
}

/** "3–1–0": wins, losses, draws — the order the profile page uses too. */
export function formatRecord(h: HeadToHead): string {
  return `${h.wins}–${h.losses}–${h.draws}`;
}

/**
 * The net rating change: "+24", "-8", or "0". A dash when there was no ranked
 * match between you, because then nothing could have moved and "0" would read
 * as "dead even".
 */
export function formatNetElo(h: HeadToHead): string {
  return h.rankedGames === 0 ? '—' : formatDelta(h.netElo);
}

/** The whole block in words, for a screen reader. */
export function describeHeadToHead(h: HeadToHead, name: string): string {
  if (h.games === 0) return `You and ${name} have not played each other yet.`;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const rating =
    h.rankedGames === 0
      ? 'no ranked games, so no rating change'
      : `${formatDelta(h.netElo)} Elo over ${plural(h.rankedGames, 'ranked game', 'ranked games')}`;
  return (
    `Against ${name}: ${plural(h.wins, 'win', 'wins')}, ${plural(h.losses, 'loss', 'losses')}, ` +
    `${plural(h.draws, 'draw', 'draws')}; ${rating}.`
  );
}
