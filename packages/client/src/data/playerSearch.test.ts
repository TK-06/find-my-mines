import type { OnlinePlayer } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import type { Friendship } from './friendsModel.js';
import { escapeLike, normalizeQuery, presenceText, rankResults, searchPattern, type FoundProfile } from './playerSearch.js';

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
