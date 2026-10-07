import { CLASSIC_PRESET, isMatchId, type Replay } from '@fmm/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinishedMatch } from '../match/matchManager.js';
import { recordMatch } from './matchRecorder.js';
import { loadReplay } from './replayLoader.js';

const REPLAY: Replay = {
  v: 1,
  rows: 3,
  cols: 3,
  mineCount: 2,
  mines: [0, 4],
  seats: [
    { name: 'Ann', bot: false },
    { name: 'Ben', bot: false },
  ],
  moves: [
    { i: 8, s: 0 },
    { i: 0, s: 1 },
    { i: 4, s: 1 },
  ],
};

const MATCH: FinishedMatch = {
  roomId: 'K7Q2',
  mode: 'casual',
  config: { ...CLASSIC_PRESET },
  winnerProfileId: null,
  players: [
    {
      clientId: 's1',
      profileId: null,
      displayName: 'Ann',
      isGuest: true,
      score: 0,
      placement: 2,
      eloBefore: 800,
      eloAfter: 800,
      eloDelta: 0,
      outcome: 'loss',
    },
  ],
};

/** What one insert into matches answers with — or an Error, for a client that throws instead of answering. */
type Result = { error: { code?: string; message: string } | null } | Error;

/** A stand-in database: each insert into matches answers with the next canned result, and every call is recorded. */
function fakeDb(matchResults: Result[]) {
  const matchInserts: Record<string, unknown>[] = [];
  const playerInserts: unknown[] = [];
  const rpcs: unknown[] = [];
  const db = {
    from(table: string) {
      if (table === 'matches') {
        return {
          insert: async (values: Record<string, unknown>) => {
            matchInserts.push(values);
            const next = matchResults.shift() ?? { error: { message: 'none left' } };
            if (next instanceof Error) throw next;
            return next;
          },
        };
      }
      return {
        insert: async (rows: unknown) => {
          playerInserts.push(rows);
          return { error: null };
        },
      };
    },
    rpc: async (name: string, args: unknown) => {
      rpcs.push([name, args]);
      return { error: null };
    },
  };
  return { db: db as never, matchInserts, playerInserts, rpcs };
}

const MISSING_COLUMN = { code: 'PGRST204', message: "Could not find the 'replay' column of 'matches' in the schema cache" };
const TOO_BIG = { code: '23514', message: 'new row for relation "matches" violates check constraint "matches_replay_size"' };
const BLIP = { message: 'TypeError: fetch failed' };
const DUPLICATE = { code: '23505', message: 'duplicate key value violates unique constraint "matches_pkey"' };

/** Options for a test: no wait before the retry, and what was reported collected in `lines`. */
function quiet() {
  const lines: string[] = [];
  return { lines, options: { retryDelayMs: 0, report: (text: string) => void lines.push(text) } };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('recordMatch', () => {
  it('saves the replay with the match, under an id of its own choosing', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: null }]);
    const id = await recordMatch(MATCH, REPLAY, db);
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(1);
    expect(matchInserts[0]).toMatchObject({ id, room_id: 'K7Q2', mode: 'casual', winner_profile_id: null, replay: REPLAY });
    // The players are written against that same match.
    expect(playerInserts).toHaveLength(1);
    expect((playerInserts[0] as { match_id: string }[])[0]!.match_id).toBe(id);
  });

  it('gives every match its own id', async () => {
    const first = fakeDb([{ error: null }]);
    const second = fakeDb([{ error: null }]);
    const a = await recordMatch(MATCH, REPLAY, first.db);
    const b = await recordMatch(MATCH, REPLAY, second.db);
    expect(a).not.toBe(b);
  });

  it('saves a match with no replay as it always did: no replay column in the insert', async () => {
    const { db, matchInserts } = fakeDb([{ error: null }]);
    const id = await recordMatch(MATCH, null, db);
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts[0]).toMatchObject({ id });
    expect(matchInserts[0]).not.toHaveProperty('replay');
    const { db: db2, matchInserts: inserts2 } = fakeDb([{ error: null }]);
    expect(isMatchId(await recordMatch(MATCH, undefined, db2))).toBe(true);
    expect(inserts2[0]).not.toHaveProperty('replay');
  });

  it('keeps the replay through a transient failure: the same insert once more, under the same id', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: BLIP }, { error: null }]);
    const { lines, options } = quiet();
    const id = await recordMatch(MATCH, REPLAY, db, options);
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[0]).toMatchObject({ id, replay: REPLAY });
    expect(matchInserts[1]).toEqual(matchInserts[0]);
    expect(playerInserts).toHaveLength(1);
    // Nothing was lost, so nothing is reported.
    expect(lines).toEqual([]);
  });

  it('treats a client that throws as a transient failure too', async () => {
    const { db, matchInserts } = fakeDb([new Error('network down'), { error: null }]);
    const id = await recordMatch(MATCH, REPLAY, db, quiet().options);
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[1]).toHaveProperty('replay');
  });

  it('waits a moment before that second try', async () => {
    vi.useFakeTimers();
    const { db, matchInserts } = fakeDb([{ error: BLIP }, { error: null }]);
    const saved = recordMatch(MATCH, REPLAY, db);
    await vi.advanceTimersByTimeAsync(100);
    expect(matchInserts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(matchInserts).toHaveLength(2);
    expect(isMatchId(await saved)).toBe(true);
  });

  it('counts a unique violation on the retry as saved: the first try landed after all', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: { message: 'timeout' } }, { error: DUPLICATE }]);
    const { lines, options } = quiet();
    const id = await recordMatch(MATCH, REPLAY, db, options);
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[1]).toMatchObject({ id, replay: REPLAY });
    // Saved once, and its players written once.
    expect(playerInserts).toHaveLength(1);
    expect((playerInserts[0] as { match_id: string }[])[0]!.match_id).toBe(id);
    expect(lines).toEqual([]);
  });

  it('still tries again without the replay when the database has no column for it, and does not wait first', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: MISSING_COLUMN }, { error: null }]);
    // A retry delay of a minute would time the test out if it were taken.
    const id = await recordMatch(MATCH, REPLAY, db, { retryDelayMs: 60_000, report: () => {} });
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[0]).toHaveProperty('replay');
    expect(matchInserts[1]).not.toHaveProperty('replay');
    expect(matchInserts[1]).toMatchObject({ id, room_id: 'K7Q2' });
    // The players are written against the match that was saved.
    expect(playerInserts).toHaveLength(1);
    expect((playerInserts[0] as { match_id: string }[])[0]!.match_id).toBe(id);
  });

  it('recognises the column missing from Postgres itself (42703) as well as from PostgREST', async () => {
    const { db, matchInserts } = fakeDb([{ error: { code: '42703', message: 'column "replay" does not exist' } }, { error: null }]);
    expect(isMatchId(await recordMatch(MATCH, REPLAY, db, { retryDelayMs: 60_000, report: () => {} }))).toBe(true);
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[1]).not.toHaveProperty('replay');
  });

  it('falls back without the replay when it is over the size check, and says the replay is lost', async () => {
    const { db, matchInserts } = fakeDb([{ error: TOO_BIG }, { error: null }]);
    const { lines, options } = quiet();
    const id = await recordMatch(MATCH, REPLAY, db, { ...options, retryDelayMs: 60_000 });
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[0]).toHaveProperty('replay');
    expect(matchInserts[1]).not.toHaveProperty('replay');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WITHOUT its replay');
    expect(lines[0]).toContain('K7Q2');
    expect(lines[0]).toContain('matches_replay_size');
  });

  it('as a last resort saves the match without the replay when the retry fails too, and says the replay is lost', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: BLIP }, { error: BLIP }, { error: null }]);
    const { lines, options } = quiet();
    const id = await recordMatch(MATCH, REPLAY, db, options);
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(3);
    expect(matchInserts[0]).toHaveProperty('replay');
    expect(matchInserts[1]).toHaveProperty('replay');
    expect(matchInserts[2]).not.toHaveProperty('replay');
    expect(new Set(matchInserts.map((values) => values.id)).size).toBe(1);
    expect(playerInserts).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WITHOUT its replay');
    expect(lines[0]).toContain('fetch failed');
  });

  it('gives up cleanly when nothing works: null, and no players written', async () => {
    const { db, matchInserts, playerInserts, rpcs } = fakeDb([{ error: BLIP }, { error: BLIP }, { error: BLIP }]);
    const { lines, options } = quiet();
    expect(await recordMatch(MATCH, REPLAY, db, options)).toBeNull();
    expect(matchInserts).toHaveLength(3);
    expect(playerInserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
    // The match was not saved at all, so it is not reported as saved without its replay.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('could not write match K7Q2');
    expect(lines[0]).not.toContain('WITHOUT');
  });

  it('gives up cleanly when the second try without the replay fails too', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: MISSING_COLUMN }, { error: { message: 'down' } }]);
    expect(await recordMatch(MATCH, REPLAY, db, quiet().options)).toBeNull();
    expect(matchInserts).toHaveLength(2);
    expect(playerInserts).toHaveLength(0);
  });

  it('retries a match with no replay once as well', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: BLIP }, { error: null }]);
    const id = await recordMatch(MATCH, null, db, quiet().options);
    expect(isMatchId(id)).toBe(true);
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[1]).toEqual(matchInserts[0]);
    expect(matchInserts[1]).not.toHaveProperty('replay');
    expect(playerInserts).toHaveLength(1);
  });

  it('does not try more than twice for a match that had no replay to drop', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ error: { message: 'down' } }, { error: { message: 'down' } }]);
    expect(await recordMatch(MATCH, null, db, quiet().options)).toBeNull();
    expect(matchInserts).toHaveLength(2);
    expect(playerInserts).toHaveLength(0);
  });

  it('says once, not after every game, that the replay column is missing and how to add it', async () => {
    vi.resetModules();
    const { recordMatch: fresh } = await import('./matchRecorder.js');
    const { lines, options } = quiet();
    for (let game = 0; game < 3; game++) {
      const { db } = fakeDb([{ error: MISSING_COLUMN }, { error: null }]);
      expect(isMatchId(await fresh(MATCH, REPLAY, db, options))).toBe(true);
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WITHOUT their replay');
    expect(lines[0]).toContain('0006_match_replays.sql');
  });

  it('reports to the console when it is not given anywhere else to say it', async () => {
    const { db } = fakeDb([{ error: TOO_BIG }, { error: null }]);
    await recordMatch(MATCH, REPLAY, db, { retryDelayMs: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WITHOUT its replay'));
  });

  it('does nothing without a database', async () => {
    expect(await recordMatch(MATCH, REPLAY, null)).toBeNull();
  });

  it('still rates a ranked match after saving it with its replay', async () => {
    const ranked: FinishedMatch = {
      ...MATCH,
      mode: 'ranked',
      players: [{ ...MATCH.players[0]!, profileId: 'p1', isGuest: false, eloAfter: 810, eloDelta: 10, outcome: 'win' }],
    };
    const { db, rpcs } = fakeDb([{ error: null }]);
    expect(isMatchId(await recordMatch(ranked, REPLAY, db))).toBe(true);
    expect(rpcs).toEqual([['apply_match_result', { p_profile_id: 'p1', p_elo_after: 810, p_outcome: 'win' }]]);
  });

  it('rates a ranked match once, however many tries saving it took', async () => {
    const ranked: FinishedMatch = {
      ...MATCH,
      mode: 'ranked',
      players: [{ ...MATCH.players[0]!, profileId: 'p1', isGuest: false, eloAfter: 810, eloDelta: 10, outcome: 'win' }],
    };
    const { db, rpcs, playerInserts } = fakeDb([{ error: BLIP }, { error: DUPLICATE }]);
    expect(isMatchId(await recordMatch(ranked, REPLAY, db, quiet().options))).toBe(true);
    expect(playerInserts).toHaveLength(1);
    expect(rpcs).toHaveLength(1);
  });

  it('never throws when the database does', async () => {
    const db = {
      from() {
        throw new Error('network down');
      },
      rpc: async () => ({}),
    };
    expect(await recordMatch(MATCH, REPLAY, db as never, quiet().options)).toBeNull();
    expect(await recordMatch(MATCH, null, db as never, quiet().options)).toBeNull();
  });

  it('never throws when only the players cannot be written', async () => {
    const { db: working } = fakeDb([{ error: null }]);
    const db = {
      from(table: string) {
        if (table === 'matches') return (working as { from: (t: string) => unknown }).from(table);
        throw new Error('network down');
      },
      rpc: async () => ({}),
    };
    await recordMatch(MATCH, REPLAY, db as never, quiet().options);
    expect(console.error).toHaveBeenCalledWith('[persist] unexpected failure:', 'network down');
  });
});

describe('loadReplay', () => {
  const ID = '6a2b1f2e-0000-4000-8000-000000000001';

  /** A stand-in database that answers a select with `answer`, and records what was asked. */
  function readDb(answer: { data: unknown; error: { code?: string; message: string } | null }) {
    const asked: unknown[][] = [];
    const db = {
      from(table: string) {
        asked.push(['from', table]);
        const chain = {
          select(columns: string) {
            asked.push(['select', columns]);
            return chain;
          },
          eq(column: string, value: string) {
            asked.push(['eq', column, value]);
            return chain;
          },
          maybeSingle: async () => answer,
        };
        return chain;
      },
    };
    return { db: db as never, asked };
  }

  it('reads only the replay column of that one match, and parses it', async () => {
    const { db, asked } = readDb({ data: { replay: REPLAY }, error: null });
    expect(await loadReplay(ID, db)).toEqual(REPLAY);
    expect(asked).toEqual([['from', 'matches'], ['select', 'replay'], ['eq', 'id', ID]]);
  });

  it('is null for a match with no replay', async () => {
    expect(await loadReplay(ID, readDb({ data: { replay: null }, error: null }).db)).toBeNull();
    expect(await loadReplay(ID, readDb({ data: null, error: null }).db)).toBeNull();
  });

  it('is null for a replay that does not hold together', async () => {
    const broken = { ...REPLAY, mineCount: 7 };
    expect(await loadReplay(ID, readDb({ data: { replay: broken }, error: null }).db)).toBeNull();
  });

  it('is null, quietly, when the column does not exist yet', async () => {
    expect(await loadReplay(ID, readDb({ data: null, error: MISSING_COLUMN }).db)).toBeNull();
  });

  it('is null for any other failure', async () => {
    expect(await loadReplay(ID, readDb({ data: null, error: { message: 'down' } }).db)).toBeNull();
  });

  it('never asks the database about something that is not a match id', async () => {
    const { db, asked } = readDb({ data: { replay: REPLAY }, error: null });
    for (const bad of ['', 'abc', "x' or 1=1 --", `${ID}0`, '../..']) expect(await loadReplay(bad, db)).toBeNull();
    expect(asked).toEqual([]);
  });

  it('is null without a database', async () => {
    expect(await loadReplay(ID, null)).toBeNull();
  });

  it('knows a match id when it sees one', () => {
    expect(isMatchId(ID)).toBe(true);
    expect(isMatchId(ID.toUpperCase())).toBe(true);
    for (const bad of [undefined, null, 7, {}, 'latest', '123']) expect(isMatchId(bad)).toBe(false);
  });
});
