import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMatchesForProfile } from './queries.js';

/**
 * A stand-in Supabase client that records each query's builder calls and
 * answers with canned results, one per query, in order. Enough to check what
 * a query asks for without a database.
 */
const fake = vi.hoisted(() => {
  type Result = { data: unknown; error: { message: string } | null };
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
