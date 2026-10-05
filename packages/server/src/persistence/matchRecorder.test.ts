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

type Result = { data: { id: string } | null; error: { code?: string; message: string } | null };

/** A stand-in database: each insert into matches answers with the next canned result, and every call is recorded. */
function fakeDb(matchResults: Result[]) {
  const matchInserts: Record<string, unknown>[] = [];
  const playerInserts: unknown[] = [];
  const rpcs: unknown[] = [];
  const db = {
    from(table: string) {
      if (table === 'matches') {
        return {
          insert(values: Record<string, unknown>) {
            matchInserts.push(values);
            return { select: () => ({ single: async () => matchResults.shift() ?? { data: null, error: { message: 'none left' } } }) };
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

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('recordMatch', () => {
  it('saves the replay with the match', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([{ data: { id: 'm1' }, error: null }]);
    expect(await recordMatch(MATCH, REPLAY, db)).toBe('m1');
    expect(matchInserts).toHaveLength(1);
    expect(matchInserts[0]).toMatchObject({ room_id: 'K7Q2', mode: 'casual', winner_profile_id: null, replay: REPLAY });
    expect(playerInserts).toHaveLength(1);
  });

  it('saves a match with no replay as it always did: no replay column in the insert', async () => {
    const { db, matchInserts } = fakeDb([{ data: { id: 'm1' }, error: null }]);
    expect(await recordMatch(MATCH, null, db)).toBe('m1');
    expect(matchInserts[0]).not.toHaveProperty('replay');
    const { db: db2, matchInserts: inserts2 } = fakeDb([{ data: { id: 'm2' }, error: null }]);
    expect(await recordMatch(MATCH, undefined, db2)).toBe('m2');
    expect(inserts2[0]).not.toHaveProperty('replay');
  });

  it('tries once more without the replay when the insert fails, so a database without the column still records', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([
      { data: null, error: MISSING_COLUMN },
      { data: { id: 'm9' }, error: null },
    ]);
    expect(await recordMatch(MATCH, REPLAY, db)).toBe('m9');
    expect(matchInserts).toHaveLength(2);
    expect(matchInserts[0]).toHaveProperty('replay');
    expect(matchInserts[1]).not.toHaveProperty('replay');
    expect(matchInserts[1]).toMatchObject({ room_id: 'K7Q2' });
    // The players are written against the match that was saved.
    expect(playerInserts).toHaveLength(1);
  });

  it('retries without the replay for any failure it cannot tell apart, such as a size check', async () => {
    const { db, matchInserts } = fakeDb([
      { data: null, error: { code: '23514', message: 'violates check constraint "matches_replay_size"' } },
      { data: { id: 'm9' }, error: null },
    ]);
    expect(await recordMatch(MATCH, REPLAY, db)).toBe('m9');
    expect(matchInserts).toHaveLength(2);
  });

  it('gives up cleanly when the second try fails too', async () => {
    const { db, matchInserts, playerInserts } = fakeDb([
      { data: null, error: MISSING_COLUMN },
      { data: null, error: { message: 'down' } },
    ]);
    expect(await recordMatch(MATCH, REPLAY, db)).toBeNull();
    expect(matchInserts).toHaveLength(2);
    expect(playerInserts).toHaveLength(0);
  });

  it('does not try twice for a match that had no replay to drop', async () => {
    const { db, matchInserts } = fakeDb([{ data: null, error: { message: 'down' } }]);
    expect(await recordMatch(MATCH, null, db)).toBeNull();
    expect(matchInserts).toHaveLength(1);
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
    const { db, rpcs } = fakeDb([{ data: { id: 'm1' }, error: null }]);
    expect(await recordMatch(ranked, REPLAY, db)).toBe('m1');
    expect(rpcs).toEqual([['apply_match_result', { p_profile_id: 'p1', p_elo_after: 810, p_outcome: 'win' }]]);
  });

  it('never throws when the database does', async () => {
    const db = {
      from() {
        throw new Error('network down');
      },
      rpc: async () => ({}),
    };
    expect(await recordMatch(MATCH, REPLAY, db as never)).toBeNull();
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
