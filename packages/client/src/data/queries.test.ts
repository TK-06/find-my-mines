import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEAD_TO_HEAD_LOOKBACK,
  fetchHeadToHead,
  fetchHeadToHeads,
  fetchMatchesByIds,
  fetchMatchesForProfile,
  fetchRecentMatches,
  fetchReplay,
  fetchSeatRecords,
} from './queries.js';

/**
 * A stand-in Supabase client that records each query's builder calls and
 * answers with canned results, one per query, in order. Enough to check what
 * a query asks for without a database.
 */
const fake = vi.hoisted(() => {
  type Result = { data: unknown; error: { code?: string; message: string } | null };
  const calls: { table: string; steps: [string, unknown[]][] }[] = [];
  const queued: Record<string, Result[]> = {};

  function from(table: string): unknown {
    const call = { table, steps: [] as [string, unknown[]][] };
    calls.push(call);
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          // Awaiting the builder runs the query.
          if (prop === 'then') {
            const result = queued[table]?.shift() ?? { data: [], error: null };
            return (resolve: (r: Result) => unknown) => resolve(result);
          }
          return (...args: unknown[]) => {
            call.steps.push([String(prop), args]);
            return chain;
          };
        },
      },
    );
    return chain;
  }

  return {
    calls,
    respond(table: string, result: Result) {
      (queued[table] ??= []).push(result);
    },
    reset() {
      calls.length = 0;
      for (const table of Object.keys(queued)) delete queued[table];
    },
    client: { from },
  };
});

// Hoisted above the import of queries.js, so it sees this client.
vi.mock('../auth/supabase.js', () => ({ supabase: fake.client }));

const seat = (matchId: string, name: string) => ({
  id: `${matchId}-${name}`,
  match_id: matchId,
  profile_id: null,
  display_name: name,
  is_guest: true,
  score: 0,
  placement: 1,
  elo_before: 800,
  elo_after: 800,
  elo_delta: 0,
  outcome: 'draw',
});

describe('fetchMatchesForProfile', () => {
  beforeEach(() => fake.reset());

  // Reading the profile's seats alone has no date to order by, so any `limit`
  // of them came back — often the oldest. The pick must go through
  // matches.created_at, like the profile history does.
  it('picks the profile’s newest matches by the match date', async () => {
    fake.respond('matches', { data: [{ id: 'm3' }, { id: 'm2' }], error: null });
    await fetchMatchesForProfile('user-1', 20);

    const pick = fake.calls[0]!;
    expect(pick.table).toBe('matches');
    expect(String(pick.steps.find(([step]) => step === 'select')?.[1][0])).toContain('match_players!inner');
    expect(pick.steps).toContainEqual(['eq', ['match_players.profile_id', 'user-1']]);
    expect(pick.steps).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(pick.steps).toContainEqual(['limit', [20]]);
  });

  it('returns those matches newest first, each with every seat', async () => {
    fake.respond('matches', { data: [{ id: 'm3' }, { id: 'm2' }], error: null });
    fake.respond('matches', {
      data: [
        { id: 'm3', room_id: 'CCCC', mode: 'casual', config: {}, winner_profile_id: null, created_at: '2026-09-03T00:00:00Z' },
        { id: 'm2', room_id: 'BBBB', mode: 'casual', config: {}, winner_profile_id: null, created_at: '2026-09-02T00:00:00Z' },
      ],
      error: null,
    });
    fake.respond('match_players', {
      data: [seat('m3', 'Ann'), seat('m3', 'Ben'), seat('m2', 'Ann')],
      error: null,
    });

    const rows = await fetchMatchesForProfile('user-1', 20);

    expect(fake.calls[1]!.steps).toContainEqual(['in', ['id', ['m3', 'm2']]]);
    expect(rows.map((row) => row.id)).toEqual(['m3', 'm2']);
    expect(rows[0]!.players.map((p) => p.display_name)).toEqual(['Ann', 'Ben']);
  });

  it('asks for nothing more when the profile has no matches', async () => {
    fake.respond('matches', { data: [], error: null });
    expect(await fetchMatchesForProfile('user-1')).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it('returns an empty list rather than throwing when the read fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.respond('matches', { data: null, error: { message: 'boom' } });
    expect(await fetchMatchesForProfile('user-1')).toEqual([]);
    quiet.mockRestore();
  });
});

/** The columns a query asked of `matches`. */
const askedColumns = (call: { steps: [string, unknown[]][] }) =>
  String(call.steps.find(([step]) => step === 'select')?.[1][0]);

const MISSING_COLUMN = { code: '42703', message: 'column matches.has_replay does not exist' };

const matchRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  room_id: 'AAAA',
  mode: 'casual',
  config: {},
  winner_profile_id: null,
  created_at: '2026-10-05T00:00:00Z',
  ...extra,
});

describe('has_replay on match lists', () => {
  beforeEach(() => fake.reset());

  it('asks for the flag, and never for the replay itself', async () => {
    fake.respond('matches', { data: [matchRow('m1', { has_replay: true })], error: null });
    await fetchRecentMatches(10);
    expect(askedColumns(fake.calls[0]!)).toContain('has_replay');
    // A list must not download a replay per match.
    expect(askedColumns(fake.calls[0]!).split(',').map((c) => c.trim())).not.toContain('replay');
  });

  it('reads the flag as a plain boolean', async () => {
    fake.respond('matches', {
      data: [matchRow('m1', { has_replay: true }), matchRow('m2', { has_replay: false }), matchRow('m3', { has_replay: null })],
      error: null,
    });
    const rows = await fetchRecentMatches(10);
    expect(rows.map((row) => row.has_replay)).toEqual([true, false, false]);
  });

  it('asks again without the flag when the column does not exist yet, and reads every match as having no replay', async () => {
    fake.respond('matches', { data: null, error: MISSING_COLUMN });
    fake.respond('matches', { data: [matchRow('m1'), matchRow('m2')], error: null });
    const rows = await fetchRecentMatches(10);

    expect(fake.calls[0]!.table).toBe('matches');
    expect(askedColumns(fake.calls[0]!)).toContain('has_replay');
    expect(askedColumns(fake.calls[1]!)).not.toContain('has_replay');
    expect(rows.map((row) => row.id)).toEqual(['m1', 'm2']);
    expect(rows.every((row) => row.has_replay === false)).toBe(true);
  });

  it('does the same when asking for matches by id (the profile pages and the guest log)', async () => {
    fake.respond('matches', { data: null, error: MISSING_COLUMN });
    fake.respond('matches', { data: [matchRow('m1')], error: null });
    fake.respond('match_players', { data: [seat('m1', 'Ann')], error: null });
    const rows = await fetchMatchesByIds(['m1']);

    expect(askedColumns(fake.calls[1]!)).not.toContain('has_replay');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.has_replay).toBe(false);
    expect(rows[0]!.players.map((p) => p.display_name)).toEqual(['Ann']);
  });

  it('does not ask twice when nothing is wrong, nor for any other failure', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.respond('matches', { data: null, error: { message: 'boom' } });
    expect(await fetchRecentMatches(10)).toEqual([]);
    expect(fake.calls).toHaveLength(1);
    quiet.mockRestore();
  });
});

describe('fetchReplay', () => {
  beforeEach(() => fake.reset());

  const ID = '6a2b1f2e-0000-4000-8000-000000000001';
  const REPLAY = {
    v: 1,
    rows: 3,
    cols: 3,
    mineCount: 2,
    mines: [0, 4],
    seats: [
      { name: 'Ann', bot: false },
      { name: 'Ben', bot: false },
    ],
    moves: [{ i: 8, s: 0 }],
  };

  it('reads only the replay column of that match, and checks what it got', async () => {
    fake.respond('matches', { data: { replay: REPLAY }, error: null });
    const result = await fetchReplay(ID);

    expect(result).toEqual({ status: 'ok', replay: REPLAY });
    const call = fake.calls[0]!;
    expect(call.table).toBe('matches');
    expect(askedColumns(call)).toBe('replay');
    expect(call.steps).toContainEqual(['eq', ['id', ID]]);
  });

  it('says there is no replay for a match saved without one', async () => {
    fake.respond('matches', { data: { replay: null }, error: null });
    expect(await fetchReplay(ID)).toEqual({ status: 'none' });
    fake.respond('matches', { data: null, error: null });
    expect(await fetchReplay(ID)).toEqual({ status: 'none' });
  });

  it('says there is no replay when the column does not exist yet (migration 0006 not run)', async () => {
    fake.respond('matches', { data: null, error: { code: '42703', message: 'column matches.replay does not exist' } });
    expect(await fetchReplay(ID)).toEqual({ status: 'none' });
  });

  it('does not trust a stored replay that does not hold together', async () => {
    fake.respond('matches', { data: { replay: { ...REPLAY, mineCount: 9 } }, error: null });
    expect(await fetchReplay(ID)).toEqual({ status: 'none' });
  });

  it('says the read failed, apart from there being nothing to read', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.respond('matches', { data: null, error: { message: 'boom' } });
    expect(await fetchReplay(ID)).toEqual({ status: 'error' });
    quiet.mockRestore();
  });

  it('never asks the database about something that is not a match id', async () => {
    expect(await fetchReplay('latest')).toEqual({ status: 'none' });
    expect(await fetchReplay("x' or 1=1")).toEqual({ status: 'none' });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('head to head', () => {
  beforeEach(() => fake.reset());

  /** A match as the inner-joined embed returns it: only the asked-for player's seat. */
  const embedded = (id: string, mode: 'casual' | 'ranked', profileId: string, outcome: string, delta = 0) => ({
    id,
    mode,
    match_players: [{ profile_id: profileId, outcome, elo_delta: delta }],
  });

  it('reads one player’s newest seats through the match date, with only the columns it needs', async () => {
    fake.respond('matches', { data: [], error: null });
    await fetchSeatRecords('user-1');

    const call = fake.calls[0]!;
    expect(call.table).toBe('matches');
    expect(askedColumns(call)).toContain('match_players!inner');
    // Not the replay, the config or anything else a card does not show.
    expect(askedColumns(call)).not.toContain('replay');
    expect(askedColumns(call)).not.toContain('config');
    expect(call.steps).toContainEqual(['eq', ['match_players.profile_id', 'user-1']]);
    expect(call.steps).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(call.steps).toContainEqual(['limit', [HEAD_TO_HEAD_LOOKBACK]]);
  });

  it('flattens each match to that player’s seat', async () => {
    fake.respond('matches', {
      data: [embedded('m2', 'ranked', 'user-1', 'win', 14), embedded('m1', 'casual', 'user-1', 'draw')],
      error: null,
    });
    expect(await fetchSeatRecords('user-1')).toEqual([
      { matchId: 'm2', profileId: 'user-1', mode: 'ranked', outcome: 'win', eloDelta: 14 },
      { matchId: 'm1', profileId: 'user-1', mode: 'casual', outcome: 'draw', eloDelta: 0 },
    ]);
  });

  it('says it could not read the seats, rather than that there are none', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.respond('matches', { data: null, error: { message: 'boom' } });
    expect(await fetchSeatRecords('user-1')).toBeNull();
    quiet.mockRestore();
  });

  it('matches the two players’ matches up by id, and counts only the ones they shared', async () => {
    // Mine: shared, plus one against somebody else. Hers: shared, plus another one of her own.
    fake.respond('matches', {
      data: [embedded('shared', 'ranked', 'me', 'win', 16), embedded('mine', 'casual', 'me', 'loss')],
      error: null,
    });
    fake.respond('matches', {
      data: [embedded('shared', 'ranked', 'ann', 'loss', -16), embedded('hers', 'ranked', 'ann', 'win', 9)],
      error: null,
    });

    expect(await fetchHeadToHead('me', 'ann')).toEqual({
      games: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      rankedGames: 1,
      netElo: 16,
    });
  });

  it('is null when either side cannot be read, so the card shows a dash instead of "no games"', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.respond('matches', { data: [], error: null });
    fake.respond('matches', { data: null, error: { message: 'boom' } });
    expect(await fetchHeadToHead('me', 'ann')).toBeNull();
    quiet.mockRestore();
  });

  it('never asks about someone against themselves or without both ids', async () => {
    expect(await fetchHeadToHead('me', 'me')).toBeNull();
    expect(await fetchHeadToHead('', 'ann')).toBeNull();
    expect(await fetchHeadToHead('me', '')).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});

describe('head to head against every friend', () => {
  beforeEach(() => fake.reset());

  /** A match as the inner-joined embed returns it: only the viewer's seat. */
  const mine = (id: string, mode: 'casual' | 'ranked', outcome: string, delta = 0) => ({
    id,
    mode,
    match_players: [{ profile_id: 'me', outcome, elo_delta: delta }],
  });
  /** A friend's seat, as `match_players` returns it. */
  const theirs = (matchId: string, profileId: string, outcome: string, delta = 0) => ({
    match_id: matchId,
    profile_id: profileId,
    outcome,
    elo_delta: delta,
  });
  const reads = () => fake.calls.filter((call) => call.table === 'match_players');
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('reads your seats once and the friends’ seats in those matches, whatever the number of friends', async () => {
    fake.respond('matches', {
      data: [mine('m1', 'ranked', 'win', 16), mine('m2', 'casual', 'loss'), mine('m3', 'casual', 'draw')],
      error: null,
    });
    fake.respond('match_players', {
      data: [theirs('m1', 'ann', 'loss', -16), theirs('m2', 'bob', 'win'), theirs('m3', 'ann', 'draw')],
      error: null,
    });

    const records = await fetchHeadToHeads('me', ['ann', 'bob', 'cy']);

    // Two reads in all — not one head-to-head (two reads) per friend.
    expect(fake.calls.map((call) => call.table)).toEqual(['matches', 'match_players']);
    const call = reads()[0]!;
    expect(call.steps).toContainEqual(['in', ['match_id', ['m1', 'm2', 'm3']]]);
    expect(call.steps).toContainEqual(['in', ['profile_id', ['ann', 'bob', 'cy']]]);
    // Not the whole seat: only what a record needs.
    expect(askedColumns(call)).toBe('match_id, profile_id, outcome, elo_delta');

    expect(records?.get('ann')).toEqual({ games: 2, wins: 1, losses: 0, draws: 1, rankedGames: 1, netElo: 16 });
    expect(records?.get('bob')).toEqual({ games: 1, wins: 0, losses: 1, draws: 0, rankedGames: 0, netElo: 0 });
    // Never met: a record of zeros, so the row says "No games yet" and not a dash.
    expect(records?.get('cy')).toEqual({ games: 0, wins: 0, losses: 0, draws: 0, rankedGames: 0, netElo: 0 });
  });

  it('gives the same numbers as the player card’s one-friend read', async () => {
    const viewer = [mine('m1', 'ranked', 'win', 16), mine('m2', 'casual', 'loss'), mine('m3', 'ranked', 'loss', -9)];
    const her = [theirs('m1', 'ann', 'loss', -16), theirs('m3', 'ann', 'win', 9)];

    fake.respond('matches', { data: viewer, error: null });
    fake.respond('match_players', { data: her, error: null });
    const all = await fetchHeadToHeads('me', ['ann']);

    fake.reset();
    fake.respond('matches', { data: viewer, error: null });
    fake.respond('matches', {
      data: [
        { id: 'm1', mode: 'ranked', match_players: [{ profile_id: 'ann', outcome: 'loss', elo_delta: -16 }] },
        { id: 'm3', mode: 'ranked', match_players: [{ profile_id: 'ann', outcome: 'win', elo_delta: 9 }] },
      ],
      error: null,
    });
    expect(all?.get('ann')).toEqual(await fetchHeadToHead('me', 'ann'));
  });

  it('keeps the match ids and the friend ids of each read short enough for an address', async () => {
    const many = Array.from({ length: 250 }, (_, i) => mine(`m${i}`, 'casual', 'win'));
    fake.respond('matches', { data: many, error: null });
    const friends = Array.from({ length: 120 }, (_, i) => `f${i}`);

    await fetchHeadToHeads('me', friends);

    // 250 matches in runs of 100 × 120 friends in runs of 50.
    expect(reads()).toHaveLength(3 * 3);
    for (const call of reads()) {
      const asked = (column: string) =>
        (call.steps.find(([step, args]) => step === 'in' && args[0] === column)?.[1][1] ?? []) as string[];
      expect(asked('match_id').length).toBeLessThanOrEqual(100);
      expect(asked('profile_id').length).toBeLessThanOrEqual(50);
    }
    // Every match and every friend is asked about exactly once.
    const seen = new Set(reads().map((call) => JSON.stringify(call.steps.filter(([step]) => step === 'in'))));
    expect(seen.size).toBe(9);
  });

  it('does not ask about friends when you have no matches at all', async () => {
    fake.respond('matches', { data: [], error: null });
    const records = await fetchHeadToHeads('me', ['ann']);
    expect(reads()).toHaveLength(0);
    expect(records?.get('ann')).toMatchObject({ games: 0 });
  });

  it('asks about nothing, and is not a failure, when there is nobody to compare with', async () => {
    const records = await fetchHeadToHeads('me', ['me', '', 'me']);
    expect(records).toEqual(new Map());
    expect(fake.calls).toHaveLength(0);
  });

  it('is null — a dash on the rows — when your own seats cannot be read', async () => {
    const spy = quiet();
    fake.respond('matches', { data: null, error: { message: 'boom' } });
    expect(await fetchHeadToHeads('me', ['ann'])).toBeNull();
    expect(reads()).toHaveLength(0);
    spy.mockRestore();
  });

  it('is null when any read of the friends’ seats fails, rather than a record with matches missing', async () => {
    const spy = quiet();
    fake.respond('matches', {
      data: Array.from({ length: 150 }, (_, i) => mine(`m${i}`, 'casual', 'win')),
      error: null,
    });
    fake.respond('match_players', { data: [theirs('m1', 'ann', 'loss')], error: null });
    fake.respond('match_players', { data: null, error: { message: 'boom' } });
    expect(await fetchHeadToHeads('me', ['ann'])).toBeNull();
    spy.mockRestore();
  });

  it('is null with no viewer', async () => {
    expect(await fetchHeadToHeads('', ['ann'])).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});
