import type { OnlinePlayer } from '@fmm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Friendship } from './friendsModel.js';
import {
  SEARCH_MIN_CHARS,
  escapeLike,
  normalizeQuery,
  presenceText,
  rankResults,
  searchPattern,
  searchProfiles,
  type FoundProfile,
} from './playerSearch.js';

/**
 * A stand-in Supabase client that records each query's builder calls and
 * answers every one with the same canned rows. Enough to check what a search
 * asks for without a database. `configured: false` plays the part of a build
 * with no Supabase keys.
 */
const fake = vi.hoisted(() => {
  type Step = [string, unknown[]];
  const state = {
    calls: [] as { table: string; steps: Step[] }[],
    rows: [] as unknown[],
    configured: true,
  };

  function from(table: string): unknown {
    const call = { table, steps: [] as Step[] };
    state.calls.push(call);
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          // Awaiting the builder runs the query.
          if (prop === 'then') {
            return (resolve: (r: unknown) => unknown) => resolve({ data: state.rows, error: null });
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

  return { state, client: { from } };
});

// Hoisted above the import of playerSearch.js, so it sees this client.
vi.mock('../auth/supabase.js', () => ({
  get supabase() {
    return fake.state.configured ? fake.client : null;
  },
}));

const profile = (id: string, username: string, elo = 800): FoundProfile => ({ id, username, elo, avatarUrl: null });

const tab = (profileId: string, status: OnlinePlayer['status']): OnlinePlayer => ({
  id: `sock-${profileId}`,
  nickname: profileId,
  isGuest: false,
  status,
  roomId: null,
  profileId,
});

const friendship = (otherId: string, status: Friendship['status'], direction: Friendship['direction']): Friendship => ({
  otherId,
  otherName: otherId,
  status,
  direction,
});

describe('search text', () => {
  it('trims and caps the query at a username’s length', () => {
    expect(normalizeQuery('  ta  ')).toBe('ta');
    expect(normalizeQuery('x'.repeat(30))).toHaveLength(20);
  });

  it('matches LIKE wildcards literally', () => {
    expect(escapeLike('ta_ko%\\')).toBe('ta\\_ko\\%\\\\');
    expect(searchPattern(' mine_hunter ')).toBe('%mine\\_hunter%');
  });

  it('describes where someone is', () => {
    expect(presenceText('offline')).toBe('Offline');
    expect(presenceText('playing')).toBe('Playing');
    expect(presenceText('lobby')).toBe('In the menu');
  });
});

describe('searching from the first letter', () => {
  it('starts at one character', () => {
    expect(SEARCH_MIN_CHARS).toBe(1);
  });

  it('keeps a single letter as the query, and a blank one as nothing', () => {
    expect(normalizeQuery(' a ')).toBe('a');
    expect(searchPattern('a')).toBe('%a%');
    expect(normalizeQuery('   ').length).toBeLessThan(SEARCH_MIN_CHARS);
  });

  it('matches a lone wildcard character literally', () => {
    expect(searchPattern('_')).toBe('%\\_%');
    expect(searchPattern('%')).toBe('%\\%%');
    expect(searchPattern('\\')).toBe('%\\\\%');
  });
});

describe('rankResults', () => {
  const found = [
    profile('p-tapioca', 'tapioca'),
    profile('p-tanuki', 'tanuki88'),
    profile('p-tamago', 'tamago'),
    profile('p-rata', 'rata'),
    profile('p-taro', 'taro'),
    profile('me', 'takoyaki'),
  ];
  const context = {
    myId: 'me',
    friendships: [friendship('p-tanuki', 'accepted', 'outgoing'), friendship('p-taro', 'pending', 'outgoing')],
    online: [tab('p-tamago', 'lobby'), tab('p-rata', 'playing')],
  };

  it('puts friends before everyone else, even offline ones', () => {
    const ranked = rankResults(found, 'ta', context);
    expect(ranked[0]).toMatchObject({ username: 'tanuki88', relation: 'friend', presence: 'offline' });
  });

  it('then people online, then names that start with the query, then by name', () => {
    const ranked = rankResults(found, 'ta', context).map((r) => r.username);
    expect(ranked).toEqual(['tanuki88', 'tamago', 'rata', 'tapioca', 'taro']);
  });

  it('ranks a one-letter query the same way: names that start with it come first', () => {
    const names = [profile('p1', 'bob'), profile('p2', 'abe'), profile('p3', 'barb'), profile('p4', 'cab')];
    const ranked = rankResults(names, 'b', { myId: 'me', friendships: [], online: [] });
    expect(ranked.map((r) => r.username)).toEqual(['barb', 'bob', 'abe', 'cab']);
    expect(ranked.map((r) => r.prefix)).toEqual([true, true, false, false]);
  });

  it('puts a friend and an online player ahead of a name that merely starts with the letter', () => {
    const names = [profile('p-bea', 'bea'), profile('p-abe', 'abe'), profile('p-cab', 'cab')];
    const ranked = rankResults(names, 'b', {
      myId: 'me',
      friendships: [friendship('p-cab', 'accepted', 'outgoing')],
      online: [tab('p-abe', 'lobby')],
    });
    expect(ranked.map((r) => r.username)).toEqual(['cab', 'abe', 'bea']);
  });

  it('marks requests both ways and leaves strangers as none', () => {
    const ranked = rankResults(
      found,
      'ta',
      { ...context, friendships: [...context.friendships, friendship('p-tapioca', 'pending', 'incoming')] },
    );
    const byName = new Map(ranked.map((r) => [r.username, r.relation]));
    expect(byName.get('taro')).toBe('outgoing');
    expect(byName.get('tapioca')).toBe('incoming');
    expect(byName.get('tamago')).toBe('none');
  });

  it('never lists yourself, and lists each player once', () => {
    const ranked = rankResults([...found, profile('p-tamago', 'tamago')], 'ta', context);
    expect(ranked.some((r) => r.id === 'me')).toBe(false);
    expect(ranked.filter((r) => r.id === 'p-tamago')).toHaveLength(1);
  });

  it('lists everyone for a guest, who has no profile to hide and no friends', () => {
    const ranked = rankResults(found, 'ta', { myId: null, friendships: [], online: context.online });
    expect(ranked.some((r) => r.id === 'me')).toBe(true);
    expect(ranked.every((r) => r.relation === 'none')).toBe(true);
  });

  it('shows the busiest tab of someone online twice', () => {
    const ranked = rankResults([profile('p-x', 'tax')], 'ta', {
      ...context,
      online: [tab('p-x', 'lobby'), tab('p-x', 'playing')],
    });
    expect(ranked[0]?.presence).toBe('playing');
  });

  it('stops at the limit', () => {
    expect(rankResults(found, 'ta', context, 2)).toHaveLength(2);
  });
});

describe('searchProfiles', () => {
  beforeEach(() => {
    fake.state.calls.length = 0;
    fake.state.rows = [];
    fake.state.configured = true;
  });

  type Call = (typeof fake.state.calls)[number];
  const step = (call: Call | undefined, name: string) => call?.steps.find(([n]) => n === name)?.[1];

  it('searches profiles for a single letter', async () => {
    fake.state.rows = [{ id: 'p1', username: 'anna', elo: 812 }];

    const outcome = await searchProfiles('a', []);

    expect(outcome).toEqual({ ok: true, found: [{ id: 'p1', username: 'anna', elo: 812, avatarUrl: null }] });
    // No friends to look for separately, so one query.
    expect(fake.state.calls).toHaveLength(1);
    expect(fake.state.calls[0]?.table).toBe('profiles');
    expect(step(fake.state.calls[0], 'ilike')).toEqual(['username', '%a%']);
  });

  it('escapes a lone wildcard, and looks for friends on their own too', async () => {
    await searchProfiles('_', ['f1', 'f2']);

    const [everyone, friends] = fake.state.calls;
    expect(step(everyone, 'ilike')).toEqual(['username', '%\\_%']);
    expect(step(friends, 'ilike')).toEqual(['username', '%\\_%']);
    expect(step(everyone, 'in')).toBeUndefined();
    expect(step(friends, 'in')).toEqual(['id', ['f1', 'f2']]);
  });

  it('sends nothing for a blank box', async () => {
    expect(await searchProfiles('   ', [])).toEqual({ ok: true, found: [] });
    expect(fake.state.calls).toHaveLength(0);
  });

  it('finds nobody, and does not throw, when Supabase is not configured', async () => {
    fake.state.configured = false;
    expect(await searchProfiles('a', [])).toEqual({ ok: true, found: [] });
  });
});
