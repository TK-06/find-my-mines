import { supabase } from '../auth/supabase.js';

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
}

/** The signed-in user's id, or null when playing as a guest. */
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, elo, games_played, wins, losses, draws, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[profile] load failed:', error.message);
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

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, room_id, mode, config, winner_profile_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

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

  return matches.map((match) => ({
    ...(match as Omit<MatchRow, 'players'>),
    players: byMatch.get(match.id as string) ?? [],
  }));
}

/** The matches one profile took part in, newest first. */
export async function fetchMatchesForProfile(userId: string, limit = 20): Promise<MatchRow[]> {
  if (!supabase) return [];

  const { data: seats } = await supabase
    .from('match_players')
    .select('match_id')
    .eq('profile_id', userId)
    .limit(limit * 2);

  const ids = [...new Set((seats ?? []).map((s) => s.match_id as string))].slice(0, limit);
  return fetchMatchesByIds(ids);
}

/**
 * Specific matches with all their seats, newest first. Used for a guest's own
 * history, whose ids this browser remembered.
 */
export async function fetchMatchesByIds(ids: string[]): Promise<MatchRow[]> {
  if (!supabase || ids.length === 0) return [];

  const { data: matches } = await supabase
    .from('matches')
    .select('id, room_id, mode, config, winner_profile_id, created_at')
    .in('id', ids)
    .order('created_at', { ascending: false });

  const { data: allSeats } = await supabase.from('match_players').select('*').in('match_id', ids);

  const byMatch = new Map<string, MatchPlayerRow[]>();
  for (const seat of (allSeats ?? []) as MatchPlayerRow[]) {
    const list = byMatch.get(seat.match_id) ?? [];
    list.push(seat);
    byMatch.set(seat.match_id, list);
  }

  return (matches ?? []).map((match) => ({
    ...(match as Omit<MatchRow, 'players'>),
    players: byMatch.get(match.id as string) ?? [],
  }));
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
