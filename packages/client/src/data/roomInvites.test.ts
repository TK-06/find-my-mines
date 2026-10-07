import { describe, expect, it } from 'vitest';
import type { OnlinePlayer, PresenceStatus, RoomConfig, RoomSummary } from '@fmm/shared';
import type { Friendship } from './friendsModel.js';
import {
  IN_THIS_ROOM_TEXT,
  INVITE_ROWS_SHOWN,
  hasSeatToOffer,
  inviteCardView,
  limitRows,
  onlineCount,
  roomInviteRows,
  showInviteCard,
  type InviteRoom,
} from './roomInvites.js';

const config = (over: Partial<RoomConfig> = {}): RoomConfig => ({
  rows: 6,
  cols: 6,
  mineCount: 11,
  maxPlayers: 4,
  mode: 'casual',
  ...over,
});

/** A waiting room I (socket "me") sit in, with one other seat free by default. */
const waitingRoom = (over: Partial<InviteRoom> = {}): InviteRoom => ({
  status: 'waiting',
  origin: 'created',
  config: config(),
  hostId: 'me',
  players: [{ id: 'me' }],
  ...over,
});

describe('hasSeatToOffer', () => {
  it('is true for a seated player in a room with a free seat', () => {
    expect(hasSeatToOffer(waitingRoom(), 'me')).toBe(true);
  });

  it('is false for a spectator, or before this tab has an id', () => {
    expect(hasSeatToOffer(waitingRoom({ hostId: 'other', players: [{ id: 'other' }] }), 'me')).toBe(false);
    expect(hasSeatToOffer(waitingRoom({ hostId: null, players: [] }), null)).toBe(false);
  });

  it('is false in a game against the computer', () => {
    expect(hasSeatToOffer(waitingRoom({ origin: 'ai' }), 'me')).toBe(false);
  });

  it('is false once every seat is taken, and true for an unlimited room', () => {
    const two = [{ id: 'me' }, { id: 'ann' }];
    expect(hasSeatToOffer(waitingRoom({ config: config({ maxPlayers: 2 }), players: two }), 'me')).toBe(false);
    expect(hasSeatToOffer(waitingRoom({ config: config({ maxPlayers: null }), players: two }), 'me')).toBe(true);
  });

  it("leaves a private room's invites to its host", () => {
    const secret = config({ private: true });
    const players = [{ id: 'me' }, { id: 'ann' }];
    expect(hasSeatToOffer(waitingRoom({ config: secret, players, hostId: 'me' }), 'me')).toBe(true);
    expect(hasSeatToOffer(waitingRoom({ config: secret, players, hostId: 'ann' }), 'me')).toBe(false);
  });
});

describe('showInviteCard', () => {
  it('shows for a signed-in player waiting in a room with a free seat', () => {
    expect(showInviteCard(waitingRoom(), 'me', true)).toBe(true);
  });

  it('never shows for a guest — friendships belong to accounts', () => {
    expect(showInviteCard(waitingRoom(), 'me', false)).toBe(false);
  });

  it('is only the next step while the room is waiting', () => {
    expect(showInviteCard(waitingRoom({ status: 'playing' }), 'me', true)).toBe(false);
    expect(showInviteCard(waitingRoom({ status: 'ended' }), 'me', true)).toBe(false);
  });

  it('follows the seat rules: not a spectator, not the computer, not full, host of a private room', () => {
    expect(showInviteCard(waitingRoom({ players: [{ id: 'ann' }], hostId: 'ann' }), 'me', true)).toBe(false);
    expect(showInviteCard(waitingRoom({ origin: 'ai' }), 'me', true)).toBe(false);
    expect(
      showInviteCard(
        waitingRoom({ config: config({ maxPlayers: 2 }), players: [{ id: 'me' }, { id: 'ann' }] }),
        'me',
        true,
      ),
    ).toBe(false);
    expect(
      showInviteCard(
        waitingRoom({ config: config({ private: true }), hostId: 'ann', players: [{ id: 'ann' }, { id: 'me' }] }),
        'me',
        true,
      ),
    ).toBe(false);
  });
});

describe('inviteCardView', () => {
  const loaded = { loaded: true, error: null, missingTable: false };

  it('hides the card when the friends table is missing, whatever else is true', () => {
    expect(inviteCardView({ ...loaded, missingTable: true }, 3)).toBe('hidden');
    expect(inviteCardView({ loaded: false, error: null, missingTable: true }, 0)).toBe('hidden');
  });

  it('says loading until the first read is back', () => {
    expect(inviteCardView({ loaded: false, error: null, missingTable: false }, 0)).toBe('loading');
  });

  it('reports a failed read rather than "no friends"', () => {
    expect(inviteCardView({ ...loaded, error: 'Could not load your friends.' }, 0)).toBe('error');
  });

  it('points to adding friends when there are none, and lists them otherwise', () => {
    expect(inviteCardView(loaded, 0)).toBe('empty');
    expect(inviteCardView(loaded, 2)).toBe('list');
  });
});

const friend = (otherId: string, otherName: string): Friendship => ({
  otherId,
  otherName,
  status: 'accepted',
  direction: 'outgoing',
});

let tabs = 0;
const tab = (
  profileId: string | null,
  status: PresenceStatus,
  roomId: string | null = null,
  over: Partial<OnlinePlayer> = {},
): OnlinePlayer => ({
  id: `socket-${tabs++}`,
  nickname: 'whoever',
  isGuest: profileId === null,
  status,
  roomId,
  profileId,
  ...over,
});

const room = (id: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
  id,
  name: `Room ${id}`,
  hostNickname: 'Host',
  config: config(),
  playerCount: 1,
  spectatorCount: 0,
  status: 'waiting',
  createdAt: 0,
  joinable: true,
  ...over,
});

/** The rows for these friends, while waiting in MINE with nobody else seated. */
const rowsFor = (
  friends: Friendship[],
  online: OnlinePlayer[],
  rooms: RoomSummary[] = [],
  memberIds: string[] = ['me'],
) => roomInviteRows(friends, online, rooms, { roomId: 'MINE', memberIds });

describe('roomInviteRows', () => {
  it('offers Invite to a friend who is free, in the menu or looking for a match', () => {
    const rows = rowsFor(
      [friend('a', 'Ann'), friend('b', 'Bo')],
      [tab('a', 'lobby'), tab('b', 'queue')],
    );
    expect(rows.map((r) => [r.name, r.slot, r.action?.kind])).toEqual([
      ['Ann', 'invite', 'invite'],
      ['Bo', 'invite', 'invite'],
    ]);
    expect(rows[0]!.statusText).toBe('In the menu');
    expect(rows[1]!.statusText).toBe('Looking for a match');
  });

  it('shows an offline friend as offline, with no button', () => {
    const [row] = rowsFor([friend('a', 'Ann')], [tab('someone-else', 'lobby')]);
    expect(row).toMatchObject({ slot: 'offline', dot: 'offline', statusText: 'Offline', action: null });
  });

  it('says a friend already seated here is in this room', () => {
    const ann = tab('a', 'room', 'MINE');
    const [row] = rowsFor([friend('a', 'Ann')], [ann], [room('MINE')], ['me', ann.id]);
    expect(row).toMatchObject({ slot: 'here', statusText: IN_THIS_ROOM_TEXT, dot: 'online' });
    expect(IN_THIS_ROOM_TEXT).toBe('In this room');
  });

  it('knows a friend watching this room is here too', () => {
    const [row] = rowsFor([friend('a', 'Ann')], [tab('a', 'watching', 'MINE')]);
    expect(row!.slot).toBe('here');
  });

  it("finds a friend in this private room by its member list, since the online list withholds its code", () => {
    const ann = tab('a', 'room', null, { privateRoom: true });
    // Without the member list she looks like she is in somebody else's private room…
    expect(rowsFor([friend('a', 'Ann')], [ann])[0]).toMatchObject({ slot: 'busy', statusText: 'In a private room' });
    // …with it, she is here.
    expect(rowsFor([friend('a', 'Ann')], [ann], [], ['me', ann.id])[0]).toMatchObject({
      slot: 'here',
      statusText: IN_THIS_ROOM_TEXT,
    });
  });

  it('does not offer Invite to a friend who is busy in another room, and says where', () => {
    const rows = rowsFor(
      [friend('a', 'Ann'), friend('b', 'Bo'), friend('c', 'Cy'), friend('d', 'Di')],
      [
        tab('a', 'playing', 'PLAY'),
        tab('b', 'room', 'WAIT'),
        tab('c', 'watching', 'SEEN'),
        tab('d', 'room', null, { privateRoom: true }),
      ],
      [room('PLAY', { status: 'playing' }), room('WAIT')],
    );
    expect(rows.map((r) => [r.name, r.slot, r.statusText])).toEqual([
      ['Ann', 'busy', 'Playing in PLAY'],
      ['Bo', 'busy', 'In room WAIT'],
      ['Cy', 'busy', 'Watching SEEN'],
      ['Di', 'busy', 'In a private room'],
    ]);
  });

  it('sorts invitable first, then here, then busy, then offline — each in friendsModel order', () => {
    const zed = tab('z', 'room', 'MINE');
    const rows = rowsFor(
      [
        friend('o', 'Olga'),
        friend('p', 'Pat'),
        friend('z', 'Zed'),
        friend('m', 'Max'),
        friend('b', 'Bea'),
        friend('a', 'Amy'),
      ],
      [
        tab('p', 'playing', 'PLAY'),
        zed,
        tab('m', 'lobby'),
        tab('b', 'lobby'),
        tab('a', 'room', 'WAIT'),
      ],
      [room('PLAY', { status: 'playing' }), room('WAIT')],
      ['me', zed.id],
    );
    expect(rows.map((r) => `${r.name}:${r.slot}`)).toEqual([
      'Bea:invite',
      'Max:invite',
      'Zed:here',
      'Pat:busy', // playing sorts before online within a group
      'Amy:busy',
      'Olga:offline',
    ]);
  });

  it('lists accepted friends only', () => {
    const rows = rowsFor(
      [friend('a', 'Ann'), { ...friend('b', 'Bo'), status: 'pending', direction: 'incoming' }],
      [],
    );
    expect(rows.map((r) => r.profileId)).toEqual(['a']);
  });

  it('never mistakes a guest tab for a friend', () => {
    expect(rowsFor([friend('a', 'Ann')], [tab(null, 'lobby')])[0]!.slot).toBe('offline');
  });
});

describe('limitRows', () => {
  const ten = Array.from({ length: 10 }, (_, i) => i);

  it('shows everything when there are few enough', () => {
    const six = ten.slice(0, INVITE_ROWS_SHOWN);
    expect(limitRows(six, false)).toEqual(six);
  });

  it('tucks the rest behind "Show all" until expanded', () => {
    expect(limitRows(ten, false)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(limitRows(ten, true)).toEqual(ten);
  });

  it('takes the limit as a parameter, and shows six by default', () => {
    expect(INVITE_ROWS_SHOWN).toBe(6);
    expect(limitRows(ten, false, 3)).toEqual([0, 1, 2]);
  });
});

describe('onlineCount', () => {
  it('counts every friend with a connected tab, wherever they are', () => {
    const rows = rowsFor(
      [friend('a', 'Ann'), friend('b', 'Bo'), friend('c', 'Cy')],
      [tab('a', 'lobby'), tab('b', 'playing', 'PLAY')],
    );
    expect(onlineCount(rows)).toBe(2);
    expect(onlineCount([])).toBe(0);
  });
});
