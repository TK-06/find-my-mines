import { isMatchId, parseReplay, type Replay } from '@fmm/shared';
import { supabase } from '../auth/supabase.js';
import { isMissingColumn } from './avatar.js';
import { headToHead, type HeadToHead, type SeatRecord } from './headToHead.js';

/**
 * Read-only queries for the profile and game-log pages.
 *
 * Everything here goes through the anon key and is protected by row-level
 * security: the tables allow public SELECT and no client writes at all, so
 * these can only ever read. Ratings are written by the game server.
 *
 * Every function returns empty data rather than throwing when Supabase is not
 * configured, so the pages render an honest empty state instead of crashing.
 */

export interface ProfileRow {
  id: string;
  username: string;
  elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  created_at: string;
  /**
   * The profile picture's place in the avatars bucket, or null for none.
   * Absent (undefined) when migration 0004 has not been run — the column does
   * not exist yet, so pictures cannot be set.
   */
  avatar_path?: string | null;
}

export interface MatchPlayerRow {
  id: string;
  match_id: string;
  profile_id: string | null;
  display_name: string;
  is_guest: boolean;
  score: number;
  placement: number;
  elo_before: number;
  elo_after: number;
  elo_delta: number;
  outcome: 'win' | 'loss' | 'draw';
}

export interface MatchRow {
  id: string;
  room_id: string;
  mode: 'casual' | 'ranked';
  config: { rows?: number; cols?: number; mineCount?: number; maxPlayers?: number | null };
  winner_profile_id: string | null;
  created_at: string;
  /**
   * The match was saved with its replay, so it can be reviewed. False for older
   * matches, and for every match until migration 0006 adds the column.
   */
  has_replay: boolean;
  players: MatchPlayerRow[];
}

export interface LeaderboardRow {
  id: string;
  username: string;
  elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number;
  /** Absent until migration 0004 adds it to the view. */
  avatar_path?: string | null;
}

/** The signed-in user's id, or null when playing as a guest. */
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

const PROFILE_COLUMNS = 'id, username, elo, games_played, wins, losses, draws, created_at';

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  if (!supabase) return null;
  let { data, error } = await supabase
    .from('profiles')
    .select(`${PROFILE_COLUMNS}, avatar_path`)
    .eq('id', userId)
    .maybeSingle();

  // Before migration 0004 there is no avatar_path column, and asking for it
  // fails the whole read. The profile still loads, just without pictures.
  if (isMissingColumn(error)) {
    ({ data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle());
  }

  if (error) {
    console.error('[profile] load failed:', error.message);
    return null;
  }
  return (data as ProfileRow) ?? null;
}

/** Someone's public profile, by their exact username — for /u/<username>. */
export async function fetchProfileByUsername(username: string): Promise<ProfileRow | null> {
  if (!supabase) return null;
  let { data, error } = await supabase
    .from('profiles')
    .select(`${PROFILE_COLUMNS}, avatar_path`)
    .eq('username', username)
    .maybeSingle();
  if (isMissingColumn(error)) {
    ({ data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('username', username).maybeSingle());
  }
  if (error) {
    console.error('[profile] load by name failed:', error.message);
    return null;
  }
  return (data as ProfileRow) ?? null;
}

/** Renaming is the only thing a client may change; a trigger freezes ratings. */
export async function updateUsername(
  userId: string,
  username: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Accounts are not configured.' };

  const clean = username.trim();
  if (clean.length < 2 || clean.length > 20) {
    return { ok: false, error: 'Username must be 2–20 characters.' };
  }

  const { error } = await supabase.from('profiles').update({ username: clean }).eq('id', userId);
  if (error) {
    // 23505 is a unique violation — the name is taken.
    return { ok: false, error: error.code === '23505' ? 'That name is taken.' : error.message };
  }
  return { ok: true };
}

/**
 * Recent matches, newest first, each with all of its seats.
 *
 * Two round trips instead of a nested order: ordering by a joined table's
 * column is a moving target across supabase-js versions, and this is both
 * predictable and easy to reason about at the scale this game runs at.
 */
export async function fetchRecentMatches(limit = 40): Promise<MatchRow[]> {
  if (!supabase) return [];

  const client = supabase;
  const { data: matches, error } = await withReplayFlag((columns) =>
    client.from('matches').select(columns).order('created_at', { ascending: false }).limit(limit),
  );

  if (error || !matches?.length) {
    if (error) console.error('[games] load failed:', error.message);
    return [];
  }

  const ids = matches.map((m) => m.id as string);
  const { data: seats } = await supabase.from('match_players').select('*').in('match_id', ids);

  const byMatch = new Map<string, MatchPlayerRow[]>();
  for (const seat of (seats ?? []) as MatchPlayerRow[]) {
    const list = byMatch.get(seat.match_id) ?? [];
    list.push(seat);
    byMatch.set(seat.match_id, list);
  }

  return matches.map((match) => toMatchRow(match, byMatch));
}

/**
 * The columns a match list reads. `has_replay` is the generated column from
 * migration 0006; the replay itself is never read here, so a list does not
 * download a replay per match.
 */
const MATCH_COLUMNS = 'id, room_id, mode, config, winner_profile_id, created_at';

type DbError = { code?: string; message: string };

/**
 * Reads matches with the `has_replay` flag. Until migration 0006 the column does
 * not exist and asking for it fails the whole read, so it is asked again
 * without it: the matches still list, and none of them offers a review.
 */
async function withReplayFlag(
  read: (columns: string) => PromiseLike<{ data: unknown; error: DbError | null }>,
): Promise<{ data: Record<string, unknown>[] | null; error: DbError | null }> {
  let result = await read(`${MATCH_COLUMNS}, has_replay`);
  if (isMissingColumn(result.error)) result = await read(MATCH_COLUMNS);
  return { data: (result.data ?? null) as Record<string, unknown>[] | null, error: result.error };
}

/** A match row as the pages use it: its seats attached, and the flag a plain boolean (false when absent). */
function toMatchRow(match: Record<string, unknown>, seats: Map<string, MatchPlayerRow[]>): MatchRow {
  return {
    ...(match as Omit<MatchRow, 'players' | 'has_replay'>),
    has_replay: match.has_replay === true,
    players: seats.get(match.id as string) ?? [],
  };
}

/**
 * The newest matches one profile took part in, newest first.
 *
 * The ids are picked from `matches` through an inner-joined, filtered
 * `match_players` embed, ordered on the match's own created_at — the same
 * shape as fetchProfileHistory. Reading the profile's seats directly has no
 * date to order by, so a limit there returned an arbitrary set, often the
 * oldest matches.
 */
export async function fetchMatchesForProfile(userId: string, limit = 20): Promise<MatchRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('matches')
    .select('id, match_players!inner(profile_id)')
    .eq('match_players.profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[games] own matches load failed:', error.message);
    return [];
  }

  const ids = (data ?? []).map((match) => match.id as string);
  return fetchMatchesByIds(ids);
}

/**
 * Specific matches with all their seats, newest first. Used for a guest's own
 * history, whose ids this browser remembered.
 */
export async function fetchMatchesByIds(ids: string[]): Promise<MatchRow[]> {
  if (!supabase || ids.length === 0) return [];

  const client = supabase;
  const { data: matches } = await withReplayFlag((columns) =>
    client.from('matches').select(columns).in('id', ids).order('created_at', { ascending: false }),
  );

  const { data: allSeats } = await supabase.from('match_players').select('*').in('match_id', ids);

  const byMatch = new Map<string, MatchPlayerRow[]>();
  for (const seat of (allSeats ?? []) as MatchPlayerRow[]) {
    const list = byMatch.get(seat.match_id) ?? [];
    list.push(seat);
    byMatch.set(seat.match_id, list);
  }

  return (matches ?? []).map((match) => toMatchRow(match, byMatch));
}

/** What reading a saved match's replay came to. Each outcome has its own honest empty state on the review page. */
export type ReplayLoad =
  | { status: 'ok'; replay: Replay }
  /** No database is configured: nothing to read from. */
  | { status: 'off' }
  /** The match has no replay: an older game, a replay that did not hold together, or no column yet (migration 0006). */
  | { status: 'none' }
  /** The read itself failed. */
  | { status: 'error' };

/**
 * The replay saved with one match, read with the anon key (matches are public)
 * and checked before anything uses it. Never throws.
 */
export async function fetchReplay(matchId: string): Promise<ReplayLoad> {
  if (!supabase) return { status: 'off' };
  if (!isMatchId(matchId)) return { status: 'none' };

  const { data, error } = await supabase.from('matches').select('replay').eq('id', matchId).maybeSingle();
  // Before migration 0006 there is no replay column: nothing was ever saved.
  if (isMissingColumn(error)) return { status: 'none' };
  if (error) {
    console.error('[review] replay load failed:', error.message);
    return { status: 'error' };
  }
  const replay = parseReplay((data as { replay?: unknown } | null)?.replay);
  return replay ? { status: 'ok', replay } : { status: 'none' };
}

/** One of your seats, with the match it was in. Feeds the profile's charts and tiles. */
export interface ProfileHistoryRow {
  match_id: string;
  created_at: string;
  mode: MatchRow['mode'];
  config: MatchRow['config'];
  score: number;
  elo_before: number;
  elo_after: number;
  elo_delta: number;
  outcome: MatchPlayerRow['outcome'];
}

/**
 * Every match one profile played, newest first, with only their own seat.
 *
 * Read from `matches` with an inner-joined, filtered `match_players` embed
 * (the match_id foreign key) rather than the other way round, so the order is
 * on the table's own column — the thing that stays stable across supabase-js
 * versions. Capped at 1000 because that is also the most rows Supabase's API
 * returns per request by default; a year of heatmap fits well inside it.
 */
export async function fetchProfileHistory(userId: string, limit = 1000): Promise<ProfileHistoryRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, created_at, mode, config, match_players!inner(profile_id, score, elo_before, elo_after, elo_delta, outcome)',
    )
    .eq('match_players.profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[profile] history load failed:', error.message);
    return [];
  }

  type Embedded = Omit<ProfileHistoryRow, 'match_id' | 'created_at' | 'mode' | 'config'>;
  const matches = (data ?? []) as unknown as (Pick<MatchRow, 'id' | 'created_at' | 'mode' | 'config'> & {
    match_players: Embedded[] | null;
  })[];

  return matches.flatMap((match) =>
    (match.match_players ?? []).map((seat) => ({
      match_id: match.id,
      created_at: match.created_at,
      mode: match.mode,
      config: match.config,
      score: seat.score,
      elo_before: seat.elo_before,
      elo_after: seat.elo_after,
      elo_delta: seat.elo_delta,
      outcome: seat.outcome,
    })),
  );
}

/**
 * How many of a player's newest matches the head-to-head looks through. Far
 * more than most players have, and under the 1000 rows Supabase returns per
 * request, so the read is never silently cut short by the API.
 */
export const HEAD_TO_HEAD_LOOKBACK = 500;

/**
 * One player's seats in their newest matches, reduced to what a head-to-head
 * needs. The same inner-joined, filtered `match_players` embed as
 * fetchProfileHistory (ordered on the match's own date), with fewer columns:
 * this runs every time a player card opens. Null when it cannot be read, so a
 * failure is not mistaken for "never played".
 */
export async function fetchSeatRecords(
  profileId: string,
  limit = HEAD_TO_HEAD_LOOKBACK,
): Promise<SeatRecord[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('matches')
    .select('id, mode, match_players!inner(profile_id, outcome, elo_delta)')
    .eq('match_players.profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[head-to-head] seats load failed:', error.message);
    return null;
  }

  type Embedded = { profile_id: string | null; outcome: SeatRecord['outcome']; elo_delta: number };
  const matches = (data ?? []) as unknown as (Pick<MatchRow, 'id' | 'mode'> & {
    match_players: Embedded[] | null;
  })[];

  return matches.flatMap((match) =>
    (match.match_players ?? []).map((seat) => ({
      matchId: match.id,
      profileId: seat.profile_id,
      mode: match.mode,
      outcome: seat.outcome,
      eloDelta: seat.elo_delta,
    })),
  );
}

/**
 * How `viewerId` has done against `otherId`: both players' recent seats, read
 * with the one query that is known to work and matched up by match id here.
 * Only matches they were both in count (see headToHead). Null when either read
 * fails, or there is no database.
 */
export async function fetchHeadToHead(viewerId: string, otherId: string): Promise<HeadToHead | null> {
  if (!supabase || !viewerId || !otherId || viewerId === otherId) return null;

  const [mine, theirs] = await Promise.all([fetchSeatRecords(viewerId), fetchSeatRecords(otherId)]);
  if (!mine || !theirs) return null;
  return headToHead([...mine, ...theirs], viewerId, otherId);
}

/**
 * Where a profile stands on the leaderboard view, and how many are ranked at
 * all. Null when they are not on it (no ranked match yet) or it can't be read;
 * `total` is null on its own if only the count failed.
 */
export async function fetchRank(userId: string): Promise<{ rank: number; total: number | null } | null> {
  if (!supabase) return null;

  const [mine, everyone] = await Promise.all([
    supabase.from('leaderboard').select('rank').eq('id', userId).maybeSingle(),
    // head: true asks for the count alone, with no rows.
    supabase.from('leaderboard').select('id', { count: 'exact', head: true }),
  ]);

  if (mine.error) {
    console.error('[profile] rank load failed:', mine.error.message);
    return null;
  }
  if (!mine.data) return null;

  return {
    rank: Number((mine.data as { rank: number | string }).rank),
    total: everyone.error ? null : (everyone.count ?? null),
  };
}

/** Top rated players. Reads the security_invoker leaderboard view. */
export async function fetchLeaderboard(limit = 25): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('rank', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[leaderboard] load failed:', error.message);
    return [];
  }
  return (data ?? []) as LeaderboardRow[];
}
