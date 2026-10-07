import { formatDelta } from './format.js';

/**
 * How you have done against one particular player, for the "You vs …" block on
 * their player card — and against all your friends at once, for the stats line
 * on each row of the Friends card.
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

/** Adds one shared match, read from the viewer's own seat, to a record. */
function addMatch(record: HeadToHead, mine: SeatRecord) {
  record.games += 1;
  if (mine.outcome === 'win') record.wins += 1;
  else if (mine.outcome === 'loss') record.losses += 1;
  else record.draws += 1;
  if (mine.mode === 'ranked') {
    record.rankedGames += 1;
    record.netElo += mine.eloDelta;
  }
}

/**
 * The record of `viewerId` against each of `otherIds` at once, from seat rows
 * of the viewer and of any of them — the Friends card's rows, which would
 * otherwise each need a pass of their own. Every other id gets an entry, all
 * zeros when you never shared a match.
 *
 * Only matches with both of you in it count — a match either of you played
 * against somebody else says nothing about the two of you. Each shared match
 * is read from the viewer's seat: their outcome, and (for a ranked one) their
 * rating change. Rows for anybody else, guests and the like are ignored, and a
 * match listed twice (the same seat read by both sides) counts once. The
 * viewer is never listed against themselves, nor an empty id against anyone.
 */
export function headToHeads(
  seats: readonly SeatRecord[],
  viewerId: string,
  otherIds: readonly string[],
): Map<string, HeadToHead> {
  const wanted = new Set(otherIds.filter((id) => id && id !== viewerId));
  const records = new Map<string, HeadToHead>();
  for (const id of wanted) records.set(id, { ...NO_HEAD_TO_HEAD });
  if (!viewerId || wanted.size === 0) return records;

  // Who was in each match: the viewer's own seat, and which of the others sat down with them.
  const byMatch = new Map<string, { mine?: SeatRecord; others: Set<string> }>();
  for (const seat of seats) {
    if (seat.profileId === null) continue;
    const isMine = seat.profileId === viewerId;
    if (!isMine && !wanted.has(seat.profileId)) continue;
    const entry = byMatch.get(seat.matchId) ?? { others: new Set<string>() };
    if (isMine) entry.mine ??= seat;
    else entry.others.add(seat.profileId);
    byMatch.set(seat.matchId, entry);
  }

  for (const { mine, others } of byMatch.values()) {
    if (!mine) continue;
    for (const id of others) addMatch(records.get(id)!, mine);
  }
  return records;
}

/**
 * The record of `viewerId` against one `otherId`, from seat rows of either or
 * both of them: the same rules as `headToHeads`, which does the work.
 */
export function headToHead(
  seats: readonly SeatRecord[],
  viewerId: string,
  otherId: string,
): HeadToHead {
  // You cannot play yourself; a "record against yourself" would be the same seats twice.
  return headToHeads(seats, viewerId, [otherId]).get(otherId) ?? NO_HEAD_TO_HEAD;
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
