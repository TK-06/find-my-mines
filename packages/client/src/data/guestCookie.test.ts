import { describe, expect, it } from 'vitest';
import { rateMatch, type ForfeitNotice, type PlayerPublic, type PublicMatchState } from '@fmm/shared';
import {
  GUEST_COOKIE,
  GUEST_KEEP_MS,
  GUEST_KEEP_SECONDS,
  clearGuestCookieString,
  endedResultApplies,
  forfeitResultApplies,
  forfeitSeats,
  isGuestName,
  newGuestProfile,
  parseGuestCookie,
  publicRatingBefore,
  readCookieValue,
  refreshed,
  serializeGuestCookie,
  unofficialRatingChange,
  withGuestName,
  withResult,
  type GuestProfile,
} from './guestCookie.js';

const NOW = 1_800_000_000_000;

const profile = (over: Partial<GuestProfile> = {}): GuestProfile => ({
  v: 1,
  name: 'Alice',
  rating: 812,
  games: 3,
  wins: 2,
  losses: 1,
  draws: 0,
  updated: NOW,
  ...over,
});

/** The value half of a cookie, as the browser would hand it back. */
const valueOf = (p: unknown) => encodeURIComponent(JSON.stringify(p));

describe('isGuestName', () => {
  it('takes what the name screen and the server take: 1 to 20 characters, trimmed', () => {
    expect(isGuestName('Alice')).toBe(true);
    expect(isGuestName('x')).toBe(true);
    expect(isGuestName('a'.repeat(20))).toBe(true);
    expect(isGuestName('ปาล์ม')).toBe(true);
  });

  it('refuses empty, padded, too long and non-text', () => {
    expect(isGuestName('')).toBe(false);
    expect(isGuestName('   ')).toBe(false);
    expect(isGuestName(' Alice')).toBe(false);
    expect(isGuestName('a'.repeat(21))).toBe(false);
    expect(isGuestName(42)).toBe(false);
    expect(isGuestName(null)).toBe(false);
  });
});

describe('serializeGuestCookie', () => {
  it('writes a 30-day, site-wide, Lax cookie holding the encoded JSON', () => {
    const text = serializeGuestCookie(profile(), false);
    expect(GUEST_KEEP_SECONDS).toBe(2_592_000);
    expect(text.startsWith(`${GUEST_COOKIE}=`)).toBe(true);
    expect(text).toContain('; Max-Age=2592000');
    expect(text).toContain('; Path=/');
    expect(text).toContain('; SameSite=Lax');
    expect(text).not.toContain('Secure');
    const value = text.slice(GUEST_COOKIE.length + 1, text.indexOf(';'));
    expect(JSON.parse(decodeURIComponent(value))).toEqual(profile());
  });

  it('adds Secure on https only', () => {
    expect(serializeGuestCookie(profile(), true)).toMatch(/; Secure$/);
  });

  it('keeps a name with spaces, semicolons or Thai letters out of the attributes', () => {
    const text = serializeGuestCookie(profile({ name: 'a; b=c ปาล์ม' }), false);
    expect(text.split(';')).toHaveLength(4);
    const value = text.slice(GUEST_COOKIE.length + 1, text.indexOf(';'));
    expect(parseGuestCookie(value, NOW)?.name).toBe('a; b=c ปาล์ม');
  });

  it('expires at once when cleared', () => {
    expect(clearGuestCookieString(true)).toBe('fmm_guest=; Max-Age=0; Path=/; SameSite=Lax; Secure');
  });
});

describe('readCookieValue', () => {
  it('finds one cookie among several', () => {
    expect(readCookieValue('a=1; fmm_guest=xyz; b=2', 'fmm_guest')).toBe('xyz');
  });

  it('does not mistake a longer name for it', () => {
    expect(readCookieValue('not_fmm_guest=1; fmm_guest_x=2', 'fmm_guest')).toBeNull();
  });

  it('is null when it is not there', () => {
    expect(readCookieValue('', 'fmm_guest')).toBeNull();
    expect(readCookieValue('a=1', 'fmm_guest')).toBeNull();
  });
});

describe('parseGuestCookie', () => {
  it('reads back what was written', () => {
    const text = serializeGuestCookie(profile(), false);
    const value = readCookieValue(text, GUEST_COOKIE);
    expect(parseGuestCookie(value, NOW)).toEqual(profile());
  });

  it('treats nothing as no cookie', () => {
    expect(parseGuestCookie(null, NOW)).toBeNull();
    expect(parseGuestCookie(undefined, NOW)).toBeNull();
    expect(parseGuestCookie('', NOW)).toBeNull();
  });

  it('treats garbage as no cookie', () => {
    for (const raw of ['%', '%E0%A4%A', 'not json', valueOf('hi'), valueOf(null), valueOf([1]), valueOf(7)]) {
      expect(parseGuestCookie(raw, NOW)).toBeNull();
    }
  });

  it('refuses the wrong version and missing fields', () => {
    expect(parseGuestCookie(valueOf({ ...profile(), v: 2 }), NOW)).toBeNull();
    expect(parseGuestCookie(valueOf({ ...profile(), v: undefined }), NOW)).toBeNull();
    const { wins: _wins, ...noWins } = profile();
    expect(parseGuestCookie(valueOf(noWins), NOW)).toBeNull();
  });

  it('refuses a name the game would refuse', () => {
    for (const name of ['', '   ', ' Alice', 'a'.repeat(21), 5, null]) {
      expect(parseGuestCookie(valueOf({ ...profile(), name }), NOW)).toBeNull();
    }
  });

  it('keeps the rating inside 100 to 3000, as a whole number', () => {
    expect(parseGuestCookie(valueOf(profile({ rating: 100 })), NOW)?.rating).toBe(100);
    expect(parseGuestCookie(valueOf(profile({ rating: 3000 })), NOW)?.rating).toBe(3000);
    for (const rating of [99, 3001, -5, 812.5, Number.NaN, Number.POSITIVE_INFINITY, '812' as unknown as number]) {
      expect(parseGuestCookie(valueOf({ ...profile(), rating }), NOW)).toBeNull();
    }
  });

  it('keeps the counts to whole numbers from zero', () => {
    for (const key of ['games', 'wins', 'losses', 'draws'] as const) {
      for (const bad of [-1, 1.5, 2_000_000, '3', null]) {
        expect(parseGuestCookie(valueOf({ ...profile(), [key]: bad }), NOW)).toBeNull();
      }
    }
  });

  it('refuses an unusable timestamp', () => {
    for (const updated of [0, -1, '1', null]) {
      expect(parseGuestCookie(valueOf({ ...profile(), updated }), NOW)).toBeNull();
    }
  });

  it('refuses a copy older than 30 days even if the browser kept it', () => {
    const old = profile({ updated: NOW - GUEST_KEEP_MS - 1 });
    expect(parseGuestCookie(valueOf(old), NOW)).toBeNull();
    expect(parseGuestCookie(valueOf(profile({ updated: NOW - GUEST_KEEP_MS })), NOW)).not.toBeNull();
  });
});

describe('keeping the record', () => {
  it('starts a new guest at 800 with nothing played', () => {
    expect(newGuestProfile('Bob', NOW)).toEqual({
      v: 1,
      name: 'Bob',
      rating: 800,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      updated: NOW,
    });
  });

  it('renaming keeps the stats; with nothing remembered it starts fresh', () => {
    expect(withGuestName(profile(), 'Alicia', NOW + 5)).toEqual(profile({ name: 'Alicia', updated: NOW + 5 }));
    expect(withGuestName(null, 'Bob', NOW).rating).toBe(800);
  });

  it('refreshing only moves the timestamp', () => {
    expect(refreshed(profile(), NOW + 9)).toEqual(profile({ updated: NOW + 9 }));
  });

  it('adds a result to the right tally', () => {
    expect(withResult(profile(), { delta: 12, outcome: 'win' }, NOW + 1)).toEqual(
      profile({ rating: 824, games: 4, wins: 3, updated: NOW + 1 }),
    );
    expect(withResult(profile(), { delta: -9, outcome: 'loss' }, NOW)).toMatchObject({ rating: 803, losses: 2, games: 4 });
    expect(withResult(profile(), { delta: 0, outcome: 'draw' }, NOW)).toMatchObject({ rating: 812, draws: 1, games: 4 });
  });

  it('never lets the rating leave the range a cookie accepts', () => {
    expect(withResult(profile({ rating: 105 }), { delta: -30, outcome: 'loss' }, NOW).rating).toBe(100);
    expect(withResult(profile({ rating: 2995 }), { delta: 30, outcome: 'win' }, NOW).rating).toBe(3000);
  });
});

// ── unofficial rating change ─────────────────────────────────────────────────

const seat = (id: string, over: Partial<PlayerPublic> = {}): PlayerPublic => ({
  id,
  nickname: id,
  score: 0,
  totalScore: 0,
  connected: true,
  elo: 800,
  isGuest: true,
  ...over,
});

const match = (over: Partial<PublicMatchState> = {}): PublicMatchState => ({
  roomId: 'ROOM',
  roomName: 'Room',
  hostId: 'me',
  config: { rows: 6, cols: 6, mineCount: 11, maxPlayers: 2, mode: 'ranked' },
  origin: 'created',
  status: 'playing',
  rows: 6,
  cols: 6,
  bombCount: 11,
  bombsFound: 0,
  players: [seat('me'), seat('them')],
  spectatorCount: 0,
  spectators: [],
  joinRequests: [],
  currentPlayerId: 'me',
  secondsLeft: 10,
  revealed: [],
  winnerId: null,
  rematchVotes: [],
  ...over,
});

describe('publicRatingBefore', () => {
  it('works an account’s rating back from the change the server applied', () => {
    expect(publicRatingBefore({ elo: 1014, eloDelta: 14, isGuest: false })).toBe(1000);
    expect(publicRatingBefore({ elo: 986, eloDelta: -14, isGuest: false })).toBe(1000);
  });

  it('takes the rating as it is before any change arrived', () => {
    expect(publicRatingBefore({ elo: 1000, isGuest: false })).toBe(1000);
  });

  it('puts guests and computers at 800', () => {
    expect(publicRatingBefore({ elo: 1234, isGuest: true })).toBe(800);
    expect(publicRatingBefore({ elo: 1234, isGuest: false, bot: { level: 'easy', model: 'ai' } })).toBe(800);
  });
});

describe('unofficialRatingChange', () => {
  const mine = { rating: 800, games: 0 };

  it('moves nothing in a casual match', () => {
    const seats = [seat('me', { score: 6 }), seat('them', { score: 5 })];
    expect(unofficialRatingChange({ ranked: false, myId: 'me', seats, profile: mine })).toBeNull();
  });

  it('gives a winning guest the provisional K: +20 against an equal', () => {
    const seats = [seat('me', { score: 6 }), seat('them', { score: 5 })];
    expect(unofficialRatingChange({ ranked: true, myId: 'me', seats, profile: mine })).toEqual({
      delta: 20,
      before: 800,
      after: 820,
      outcome: 'win',
    });
  });

  it('takes the same from a loser', () => {
    const seats = [seat('me', { score: 3 }), seat('them', { score: 8 })];
    expect(unofficialRatingChange({ ranked: true, myId: 'me', seats, profile: mine })).toMatchObject({
      delta: -20,
      after: 780,
      outcome: 'loss',
    });
  });

  it('a draw between equals is flat', () => {
    const seats = [seat('me', { score: 5 }), seat('them', { score: 5 })];
    expect(unofficialRatingChange({ ranked: true, myId: 'me', seats, profile: mine })).toMatchObject({
      delta: 0,
      outcome: 'draw',
    });
  });

  it('uses the guest’s stored rating and games, not 800', () => {
    const seats = [seat('me', { score: 6 }), seat('them', { score: 5 })];
    // 30 games and under 2400: the standard K of 20, and a favourite wins less.
    const change = unofficialRatingChange({
      ranked: true,
      myId: 'me',
      seats,
      profile: { rating: 1000, games: 30 },
    });
    const expected = rateMatch(
      [
        { id: 'me', rating: 1000, gamesPlayed: 30, score: 6, isGuest: false },
        { id: 'them', rating: 800, gamesPlayed: 0, score: 5, isGuest: true },
      ],
      true,
    )[0]!;
    expect(change).toMatchObject({ delta: expected.delta, before: 1000, after: 1000 + expected.delta });
    expect(change!.delta).toBeLessThan(20);
    expect(change!.delta).toBeGreaterThan(0);
  });

  it('rates an opponent at the rating they walked in with, not the one they ended on', () => {
    // 1200 before; the server has already applied -16, so `elo` reads 1184.
    const seats = [seat('me', { score: 6 }), seat('them', { score: 5, isGuest: false, elo: 1184, eloDelta: -16 })];
    const change = unofficialRatingChange({ ranked: true, myId: 'me', seats, profile: mine })!;
    const expected = rateMatch(
      [
        { id: 'me', rating: 800, gamesPlayed: 0, score: 6, isGuest: false },
        { id: 'them', rating: 1200, gamesPlayed: 0, score: 5, isGuest: true },
      ],
      true,
    )[0]!;
    expect(change.delta).toBe(expected.delta);
    expect(change.delta).toBeGreaterThan(20);
  });

  it('settles a free-for-all pairwise, divided by the others', () => {
    const seats = [seat('me', { score: 9 }), seat('b', { score: 5 }), seat('c', { score: 1 })];
    const change = unofficialRatingChange({ ranked: true, myId: 'me', seats, profile: mine })!;
    // Beat both equals: (20 + 20) / 2.
    expect(change).toMatchObject({ delta: 20, outcome: 'win' });
    const middle = unofficialRatingChange({ ranked: true, myId: 'b', seats, profile: mine })!;
    expect(middle).toMatchObject({ delta: 0, outcome: 'draw' });
  });

  it('says nothing when the guest was not in the match or alone', () => {
    const seats = [seat('a', { score: 1 }), seat('b', { score: 0 })];
    expect(unofficialRatingChange({ ranked: true, myId: 'me', seats, profile: mine })).toBeNull();
    expect(unofficialRatingChange({ ranked: true, myId: 'a', seats: [seats[0]!], profile: mine })).toBeNull();
  });
});

describe('forfeits', () => {
  const notice: ForfeitNotice = {
    roomId: 'ROOM',
    winnerId: 'me',
    winnerNickname: 'me',
    leaverNickname: 'them',
    players: [
      { id: 'me', nickname: 'me', score: 2 },
      { id: 'them', nickname: 'them', score: 7, eloDelta: -16 },
    ],
  };
  const snapshot = match({
    players: [seat('me'), seat('them', { isGuest: false, elo: 1200 })],
  });

  it('scores the winner 1 and the leaver 0, whatever the mines said', () => {
    const seats = forfeitSeats(notice, snapshot);
    expect(seats.map((s) => [s.id, s.score])).toEqual([
      ['me', 1],
      ['them', 0],
    ]);
  });

  it('takes the leaver’s rating from before the forfeit, because they are no longer seated', () => {
    const seats = forfeitSeats(notice, snapshot);
    expect(publicRatingBefore(seats[1]!)).toBe(1200);
    const change = unofficialRatingChange({ ranked: true, myId: 'me', seats, profile: { rating: 800, games: 0 } })!;
    expect(change.outcome).toBe('win');
    expect(change.delta).toBeGreaterThan(20);
  });

  it('falls back to a guest at 800 for someone the snapshot never saw', () => {
    const seats = forfeitSeats(notice, match({ players: [seat('me')] }));
    expect(publicRatingBefore(seats[1]!)).toBe(800);
  });
});

// ── once per match ───────────────────────────────────────────────────────────

describe('endedResultApplies', () => {
  const playing = match();
  const ended = match({ status: 'ended', winnerId: 'me' });

  it('counts playing then ended, seated', () => {
    expect(endedResultApplies(playing, ended, 'me')).toBe(true);
  });

  it('does not count it twice: once counted the caller drops the snapshot', () => {
    expect(endedResultApplies(null, ended, 'me')).toBe(false);
  });

  it('does not count an ended state that was already ended', () => {
    expect(endedResultApplies(ended, ended, 'me')).toBe(false);
  });

  it('does not count a reconnect straight into an ended match', () => {
    expect(endedResultApplies(null, ended, 'me')).toBe(false);
  });

  it('does not count a waiting room, or a match that is still going', () => {
    expect(endedResultApplies(playing, match({ status: 'waiting' }), 'me')).toBe(false);
    expect(endedResultApplies(playing, playing, 'me')).toBe(false);
    expect(endedResultApplies(match({ status: 'waiting' }), ended, 'me')).toBe(false);
  });

  it('does not count another room’s end', () => {
    expect(endedResultApplies(playing, match({ roomId: 'OTHER', status: 'ended' }), 'me')).toBe(false);
  });

  it('does not count a spectator, or someone with no identity yet', () => {
    expect(endedResultApplies(playing, ended, 'watcher')).toBe(false);
    expect(endedResultApplies(playing, ended, null)).toBe(false);
  });
});

describe('forfeitResultApplies', () => {
  const notice: ForfeitNotice = {
    roomId: 'ROOM',
    winnerId: 'me',
    winnerNickname: 'me',
    leaverNickname: 'them',
    players: [
      { id: 'me', nickname: 'me', score: 2 },
      { id: 'them', nickname: 'them', score: 7 },
    ],
  };

  it('counts a win by forfeit seen from the playing room', () => {
    expect(forfeitResultApplies(match(), notice, 'me')).toBe(true);
  });

  it('needs a snapshot of the match that was being played', () => {
    expect(forfeitResultApplies(null, notice, 'me')).toBe(false);
    expect(forfeitResultApplies(match({ status: 'waiting' }), notice, 'me')).toBe(false);
  });

  it('is only for the player who stayed, in that room', () => {
    expect(forfeitResultApplies(match(), notice, 'them')).toBe(false);
    expect(forfeitResultApplies(match(), notice, null)).toBe(false);
    expect(forfeitResultApplies(match({ roomId: 'OTHER' }), notice, 'me')).toBe(false);
  });
});
