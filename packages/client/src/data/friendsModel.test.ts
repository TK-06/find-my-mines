import { describe, expect, it } from 'vitest';
import type { FriendInvite, OnlinePlayer, PresenceStatus, RoomSummary } from '@fmm/shared';
import {
  cardFriendButton,
  changeNotice,
  INVITE_TTL_MS,
  MAX_INVITES,
  PRIVATE_ROOM_TEXT,
  addInvite,
  friendRows,
  groupFriendships,
  initialOf,
  isMissingTable,
  requestNotice,
  requestPlan,
  toFriendships,
  withBusy,
  type Friendship,
} from './friendsModel.js';

const ME = 'me-id';

const friend = (otherId: string, otherName: string, over: Partial<Friendship> = {}): Friendship => ({
  otherId,
  otherName,
  status: 'accepted',
  direction: 'outgoing',
  ...over,
});

let tab = 0;
const onlineAs = (
  profileId: string | null,
  status: PresenceStatus,
  roomId: string | null = null,
): OnlinePlayer => ({
  id: `socket-${tab++}`,
  nickname: 'whoever',
  isGuest: profileId === null,
  status,
  roomId,
  profileId,
});

const room = (id: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
  id,
  name: `Room ${id}`,
  hostNickname: 'Host',
  config: { rows: 6, cols: 6, mineCount: 11, maxPlayers: 4, mode: 'casual' },
  playerCount: 1,
  spectatorCount: 0,
  status: 'waiting',
  createdAt: 0,
  joinable: true,
  ...over,
});

/** The single row for one friend, given where their tabs are. */
const rowFor = (
  tabs: OnlinePlayer[],
  rooms: RoomSummary[] = [],
  myRoomId: string | null = null,
) => friendRows([friend('ann', 'Ann')], tabs, rooms, myRoomId)[0]!;

describe('toFriendships', () => {
  const names = new Map([
    ['ann', 'Ann'],
    ['bo', 'Bo'],
  ]);

  it('sees each row from my side: the other person, and who asked', () => {
    const list = toFriendships(
      [
        { requester_id: ME, addressee_id: 'ann', status: 'pending' },
        { requester_id: 'bo', addressee_id: ME, status: 'accepted' },
      ],
      ME,
      names,
    );
    expect(list).toEqual([
      { otherId: 'ann', otherName: 'Ann', status: 'pending', direction: 'outgoing' },
      { otherId: 'bo', otherName: 'Bo', status: 'accepted', direction: 'incoming' },
    ]);
  });

  it('drops rows that are not mine and statuses it does not know', () => {
    const list = toFriendships(
      [
        { requester_id: 'ann', addressee_id: 'bo', status: 'accepted' },
        { requester_id: ME, addressee_id: 'ann', status: 'blocked' },
      ],
      ME,
      names,
    );
    expect(list).toEqual([]);
  });

  it('still lists someone whose profile could not be read', () => {
    const [only] = toFriendships(
      [{ requester_id: ME, addressee_id: 'gone', status: 'accepted' }],
      ME,
      names,
    );
    expect(only?.otherName).toBe('Unknown player');
  });
});

describe('groupFriendships', () => {
  it('splits requests to me, requests from me, and friends — each by name', () => {
    const groups = groupFriendships([
      friend('z', 'Zed'),
      friend('c', 'cat', { status: 'pending', direction: 'incoming' }),
      friend('a', 'Ann'),
      friend('o', 'Oli', { status: 'pending', direction: 'outgoing' }),
      friend('b', 'Bea', { status: 'pending', direction: 'incoming' }),
    ]);
    expect(groups.incoming.map((f) => f.otherName)).toEqual(['Bea', 'cat']);
    expect(groups.outgoing.map((f) => f.otherName)).toEqual(['Oli']);
    expect(groups.accepted.map((f) => f.otherName)).toEqual(['Ann', 'Zed']);
  });
});

describe('friendRows — status', () => {
  it('shows a friend with no connected tab as offline, grey, with nothing to do', () => {
    const row = rowFor([onlineAs('someone-else', 'lobby')], [], 'ROOM');
    expect(row).toMatchObject({
      presence: 'offline',
      dot: 'offline',
      statusText: 'Offline',
      action: null,
    });
  });

  it('describes every place a friend can be', () => {
    const text = (status: PresenceStatus, roomId: string | null) =>
      rowFor([onlineAs('ann', status, roomId)]).statusText;
    expect(text('lobby', null)).toBe('In the menu');
    expect(text('queue', null)).toBe('Looking for a match');
    expect(text('room', 'ABCD')).toBe('In room ABCD');
    expect(text('playing', 'ABCD')).toBe('Playing in ABCD');
    expect(text('watching', 'ABCD')).toBe('Watching ABCD');
  });

  it('colours playing yellow and every other online place green', () => {
    const dot = (status: PresenceStatus) => rowFor([onlineAs('ann', status, 'ABCD')]).dot;
    expect(dot('playing')).toBe('playing');
    expect(dot('lobby')).toBe('online');
    expect(dot('queue')).toBe('online');
    expect(dot('room')).toBe('online');
    expect(dot('watching')).toBe('online');
  });

  it('uses the most active of several open tabs: playing, room, watching, queue, lobby', () => {
    expect(
      rowFor([
        onlineAs('ann', 'lobby'),
        onlineAs('ann', 'playing', 'PLAY'),
        onlineAs('ann', 'room', 'WAIT'),
      ]).statusText,
    ).toBe('Playing in PLAY');
    expect(
      rowFor([onlineAs('ann', 'watching', 'SEEN'), onlineAs('ann', 'room', 'WAIT')]).statusText,
    ).toBe('In room WAIT');
    expect(rowFor([onlineAs('ann', 'queue'), onlineAs('ann', 'watching', 'SEEN')]).statusText).toBe(
      'Watching SEEN',
    );
    expect(rowFor([onlineAs('ann', 'lobby'), onlineAs('ann', 'queue')]).statusText).toBe(
      'Looking for a match',
    );
  });

  it('says a friend is in a private room without naming it', () => {
    for (const status of ['room', 'playing', 'watching'] as const) {
      const row = rowFor([{ ...onlineAs('ann', status, null), privateRoom: true }]);
      expect(row.statusText).toBe(PRIVATE_ROOM_TEXT);
      expect(row.roomId).toBeNull();
    }
    expect(PRIVATE_ROOM_TEXT).toBe('In a private room');
  });

  it('still colours a friend playing in a private room yellow', () => {
    expect(rowFor([{ ...onlineAs('ann', 'playing', null), privateRoom: true }]).dot).toBe('playing');
  });

  it('never mistakes a guest tab for a friend', () => {
    expect(rowFor([onlineAs(null, 'lobby')]).presence).toBe('offline');
  });
});

describe('friendRows — what you can do', () => {
  it('offers Watch while a friend is playing', () => {
    const row = rowFor([onlineAs('ann', 'playing', 'PLAY')], [room('PLAY', { status: 'playing' })]);
    expect(row.action).toEqual({ kind: 'watch', roomId: 'PLAY', label: 'Watch' });
  });

  it('offers Watch to a friend watching a match that is under way', () => {
    const row = rowFor([onlineAs('ann', 'watching', 'PLAY')], [room('PLAY', { status: 'playing' })]);
    expect(row.action).toEqual({ kind: 'watch', roomId: 'PLAY', label: 'Watch' });
  });

  it('offers Join when a friend waits in a room with a free seat', () => {
    const row = rowFor([onlineAs('ann', 'room', 'WAIT')], [room('WAIT')]);
    expect(row.action).toEqual({ kind: 'join', roomId: 'WAIT', label: 'Join' });
  });

  it('says Ask for an ask-to-join room, like the online list', () => {
    const askRoom = room('WAIT', {
      config: { rows: 6, cols: 6, mineCount: 10, maxPlayers: 3, mode: 'casual', joinByRequest: true },
    });
    expect(rowFor([onlineAs('ann', 'room', 'WAIT')], [askRoom]).action).toEqual({
      kind: 'join',
      roomId: 'WAIT',
      label: 'Ask',
    });
  });

  it('offers nothing for a full room or one the lobby no longer lists', () => {
    expect(rowFor([onlineAs('ann', 'room', 'FULL')], [room('FULL', { joinable: false })]).action).toBeNull();
    expect(rowFor([onlineAs('ann', 'room', 'GONE')], []).action).toBeNull();
  });

  it('offers Invite when the friend is free and I am in a room', () => {
    expect(rowFor([onlineAs('ann', 'lobby')], [], 'MINE').action).toEqual({
      kind: 'invite',
      label: 'Invite',
    });
    expect(rowFor([onlineAs('ann', 'queue')], [], 'MINE').action?.kind).toBe('invite');
  });

  it('offers no Invite when I am not in a room myself', () => {
    expect(rowFor([onlineAs('ann', 'lobby')], [], null).action).toBeNull();
  });

  it('offers nothing for a friend in a private room — the server keeps its code back', () => {
    // A private room's code is withheld (roomId null), so there is nothing to
    // join or watch — and the friend is busy, so no Invite either.
    for (const status of ['room', 'playing', 'watching'] as const) {
      const tab = { ...onlineAs('ann', status, null), privateRoom: true };
      expect(rowFor([tab], [], null).action).toBeNull();
      expect(rowFor([tab], [], 'MINE').action).toBeNull();
    }
  });

  it('offers nothing when we are already in the same room — joining it again would drop my seat', () => {
    const together = room('MINE', { status: 'playing' });
    expect(rowFor([onlineAs('ann', 'playing', 'MINE')], [together], 'MINE').action).toBeNull();
    expect(rowFor([onlineAs('ann', 'room', 'MINE')], [room('MINE')], 'MINE').action).toBeNull();
  });
});

describe('friendRows — order', () => {
  it('puts playing first, then online, then offline, then by name', () => {
    const rows = friendRows(
      [
        friend('o1', 'Oscar'),
        friend('p1', 'pat'),
        friend('n1', 'Nia'),
        friend('p2', 'Paz'),
        friend('o2', 'Ola'),
        friend('n2', 'amy'),
      ],
      [
        onlineAs('p1', 'playing', 'A'),
        onlineAs('p2', 'playing', 'B'),
        onlineAs('n1', 'lobby'),
        onlineAs('n2', 'room', 'C'),
      ],
      [],
      null,
    );
    expect(rows.map((r) => r.name)).toEqual(['pat', 'Paz', 'amy', 'Nia', 'Ola', 'Oscar']);
  });

  it('lists accepted friends only — requests are shown on their own', () => {
    const rows = friendRows(
      [friend('a', 'Ann'), friend('b', 'Bo', { status: 'pending', direction: 'incoming' })],
      [],
      [],
      null,
    );
    expect(rows.map((r) => r.profileId)).toEqual(['a']);
  });
});

describe('requestPlan', () => {
  it('refuses asking yourself', () => {
    expect(requestPlan(ME, ME, undefined)).toBe('self');
  });

  it('sends a request when there is nothing between you yet', () => {
    expect(requestPlan(ME, 'ann', undefined)).toBe('send');
  });

  it('says so when you are already friends, whoever asked', () => {
    expect(requestPlan(ME, 'ann', friend('ann', 'Ann'))).toBe('already-friends');
    expect(requestPlan(ME, 'ann', friend('ann', 'Ann', { direction: 'incoming' }))).toBe(
      'already-friends',
    );
  });

  it('says so when your request is still waiting', () => {
    expect(
      requestPlan(ME, 'ann', friend('ann', 'Ann', { status: 'pending', direction: 'outgoing' })),
    ).toBe('already-requested');
  });

  it('accepts theirs when they already asked you', () => {
    expect(
      requestPlan(ME, 'ann', friend('ann', 'Ann', { status: 'pending', direction: 'incoming' })),
    ).toBe('accept-theirs');
  });
});

describe('addInvite', () => {
  const invite = (id: string, fromProfileId: string, roomId: string): FriendInvite => ({
    id,
    fromName: fromProfileId,
    fromProfileId,
    roomId,
    roomName: `Room ${roomId}`,
    sentAt: 0,
  });

  it('adds the newest invite last', () => {
    const list = addInvite([invite('1', 'ann', 'A')], invite('2', 'bo', 'B'));
    expect(list.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('replaces an older invite from the same friend to the same room', () => {
    const list = addInvite(
      [invite('1', 'ann', 'A'), invite('2', 'bo', 'B')],
      invite('3', 'ann', 'A'),
    );
    expect(list.map((i) => i.id)).toEqual(['2', '3']);
  });

  it('keeps an invite from the same friend to a different room', () => {
    const list = addInvite([invite('1', 'ann', 'A')], invite('2', 'ann', 'B'));
    expect(list.map((i) => i.id)).toEqual(['1', '2']);
  });

  it(`keeps at most ${MAX_INVITES}, dropping the oldest`, () => {
    let list: FriendInvite[] = [];
    for (const n of ['1', '2', '3', '4']) list = addInvite(list, invite(n, `f${n}`, n));
    expect(MAX_INVITES).toBe(3);
    expect(list.map((i) => i.id)).toEqual(['2', '3', '4']);
  });

  it('lets an invite live for a minute', () => {
    expect(INVITE_TTL_MS).toBe(60_000);
  });
});

describe('isMissingTable', () => {
  it('recognises the table not existing yet, from PostgREST or Postgres', () => {
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTable({ code: '42P01' })).toBe(true);
  });

  it('does not blame the migration for any other failure', () => {
    expect(isMissingTable({ code: '42501' })).toBe(false);
    expect(isMissingTable({})).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe('initialOf', () => {
  it('is the first letter, upper-cased', () => {
    expect(initialOf('taj')).toBe('T');
    expect(initialOf('  bo')).toBe('B');
  });

  it('keeps a character made of two code units whole', () => {
    expect(initialOf('𝔸lex')).toBe('𝔸');
  });

  it('falls back to a question mark for an empty name', () => {
    expect(initialOf('   ')).toBe('?');
  });
});

describe('cardFriendButton', () => {
  const pending = (direction: 'incoming' | 'outgoing') =>
    ({ otherId: 'x', otherName: 'x', status: 'pending', direction }) as const;

  it('asks a guest viewer to sign in', () => {
    expect(cardFriendButton(false, null)).toMatchObject({ does: 'none', note: 'Sign in to add friends.' });
  });

  it('waits while the friendship loads', () => {
    expect(cardFriendButton(true, undefined)).toMatchObject({ label: 'Add friend', does: 'none' });
  });

  it('offers Add with nothing between you, or when it could not be read', () => {
    expect(cardFriendButton(true, null)).toMatchObject({ label: 'Add friend', does: 'add' });
    expect(cardFriendButton(true, 'unknown')).toMatchObject({ label: 'Add friend', does: 'add' });
  });

  it('accepts their request, and waits on yours', () => {
    expect(cardFriendButton(true, pending('incoming'))).toMatchObject({ label: 'Accept request', does: 'accept' });
    expect(cardFriendButton(true, pending('outgoing'))).toMatchObject({ label: 'Requested', does: 'none' });
  });

  it('says Friends once you are', () => {
    expect(
      cardFriendButton(true, { otherId: 'x', otherName: 'x', status: 'accepted', direction: 'outgoing' }),
    ).toMatchObject({ label: 'Friends', does: 'none', primary: false });
  });
});

describe('withBusy', () => {
  it('adds and removes a person without touching the set it was given', () => {
    const none: ReadonlySet<string> = new Set();
    const one = withBusy(none, 'ann', true);
    expect([...one]).toEqual(['ann']);
    expect([...none]).toEqual([]);
    expect([...withBusy(one, 'bob', true)]).toEqual(['ann', 'bob']);
    expect([...withBusy(one, 'ann', false)]).toEqual([]);
  });

  it('leaves the others alone, and takes away someone who is not there without fuss', () => {
    const both = withBusy(withBusy(new Set(), 'ann', true), 'bob', true);
    expect([...withBusy(both, 'ann', false)]).toEqual(['bob']);
    expect([...withBusy(both, 'cy', false)]).toEqual(['ann', 'bob']);
  });
});

describe('requestNotice', () => {
  it('says the request went out when nothing more was said', () => {
    expect(requestNotice({ ok: true }, 'Ann')).toEqual({ text: 'Request sent to Ann.', failed: false });
  });

  it('prefers what the call said, success or not', () => {
    expect(requestNotice({ ok: true, message: 'Ann had already asked you — you’re friends now.' }, 'Ann')).toEqual({
      text: 'Ann had already asked you — you’re friends now.',
      failed: false,
    });
    expect(requestNotice({ ok: false, message: 'You already asked Ann.' }, 'Ann')).toEqual({
      text: 'You already asked Ann.',
      failed: true,
    });
  });

  it('has a plain line for a failure that gave no reason', () => {
    expect(requestNotice({ ok: false }, 'Ann')).toEqual({ text: 'That did not work.', failed: true });
  });
});

describe('changeNotice', () => {
  it('reports a failure, with its reason when it has one', () => {
    expect(changeNotice({ ok: false, message: 'That request is no longer there.' })).toEqual({
      text: 'That request is no longer there.',
      failed: true,
    });
    expect(changeNotice({ ok: false }, 'You and Ann are friends now.')).toEqual({
      text: 'That did not work.',
      failed: true,
    });
  });

  it('says the good news when there is some, and nothing when there is not', () => {
    expect(changeNotice({ ok: true }, 'You and Ann are friends now.')).toEqual({
      text: 'You and Ann are friends now.',
      failed: false,
    });
    expect(changeNotice({ ok: true })).toBeNull();
  });
});
