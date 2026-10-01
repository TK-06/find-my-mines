import { describe, expect, it } from 'vitest';
import type { LobbyInvite, LobbyMessage, RoomConfig, RoomSummary } from '@fmm/shared';
import { groupMessages } from './chat.js';
import {
  LOBBY_CHAT_LIMIT,
  addLobbyMessage,
  inviteAvailability,
  isLobbyMessage,
  lobbyHistory,
} from './worldChat.js';

const T0 = new Date(2026, 8, 29, 9, 5, 0).getTime();

let seq = 0;
const line = (over: Partial<LobbyMessage> = {}): LobbyMessage => ({
  id: `m${seq++}`,
  fromId: 'ann',
  fromName: 'Ann',
  isGuest: true,
  fromAvatarUrl: null,
  kind: 'player',
  text: 'hi',
  at: T0,
  ...over,
});

const INVITE: LobbyInvite = {
  roomId: 'ABCD',
  roomName: 'Friday night',
  rows: 6,
  cols: 6,
  mineCount: 8,
  playerCount: 1,
  maxPlayers: 4,
  mode: 'casual',
  joinByRequest: false,
};

const card = (invite: Partial<LobbyInvite> = {}): LobbyMessage =>
  line({ kind: 'invite', text: 'Ann invited everyone to Friday night', invite: { ...INVITE, ...invite } });

const CONFIG: RoomConfig = { rows: 6, cols: 6, mineCount: 8, maxPlayers: 4, mode: 'casual' };
const listed = (over: Partial<RoomSummary> = {}, config: Partial<RoomConfig> = {}): RoomSummary => ({
  id: 'ABCD',
  name: 'Friday night',
  hostNickname: 'Ann',
  config: { ...CONFIG, ...config },
  playerCount: 2,
  spectatorCount: 0,
  status: 'waiting',
  createdAt: 0,
  joinable: true,
  ...over,
});

describe('isLobbyMessage', () => {
  it('accepts a player line and an invite card', () => {
    expect(isLobbyMessage(line())).toBe(true);
    expect(isLobbyMessage(card())).toBe(true);
  });

  it('refuses anything else the network might send', () => {
    for (const bad of [
      null,
      undefined,
      42,
      'hi',
      [],
      { ...line(), text: 7 },
      { ...line(), id: undefined },
      { ...line(), at: 'noon' },
      { ...line(), kind: 'bot' },
      // An invite card without its room cannot offer a Join button.
      { ...card(), invite: undefined },
      { ...card(), invite: { ...INVITE, roomId: 5 } },
    ]) {
      expect(isLobbyMessage(bad)).toBe(false);
    }
  });
});

describe('addLobbyMessage', () => {
  it('appends a new line', () => {
    const first = line();
    const second = line({ text: 'again' });
    expect(addLobbyMessage(addLobbyMessage([], first), second)).toEqual([first, second]);
  });

  it('returns the same list for a line it already has, so React skips the render', () => {
    const once = line();
    const list = [once];
    expect(addLobbyMessage(list, { ...once })).toBe(list);
  });

  it('returns the same list for something that is not a line', () => {
    const list: LobbyMessage[] = [];
    expect(addLobbyMessage(list, { nope: true })).toBe(list);
  });

  it(`keeps only the newest ${LOBBY_CHAT_LIMIT}`, () => {
    expect(LOBBY_CHAT_LIMIT).toBe(100);
    let list: LobbyMessage[] = [];
    const sent = Array.from({ length: LOBBY_CHAT_LIMIT + 3 }, () => line());
    for (const message of sent) list = addLobbyMessage(list, message);
    expect(list).toEqual(sent.slice(-LOBBY_CHAT_LIMIT));
  });
});

describe('lobbyHistory', () => {
  it('takes the valid lines, oldest first, once each', () => {
    const a = line();
    const b = line();
    expect(lobbyHistory([a, { junk: 1 }, b, { ...a }])).toEqual([a, b]);
  });

  it('is empty for a history that is not a list', () => {
    expect(lobbyHistory(null)).toEqual([]);
    expect(lobbyHistory({ 0: line() })).toEqual([]);
  });

  it('keeps only the newest of a long history', () => {
    const sent = Array.from({ length: 5 }, () => line());
    expect(lobbyHistory(sent, 3)).toEqual(sent.slice(-3));
  });
});

describe('inviteAvailability', () => {
  it('offers Join with the live player count while the listed room has a seat', () => {
    expect(inviteAvailability(INVITE, [listed({ playerCount: 3 })])).toEqual({
      canJoin: true,
      label: 'Join',
      playerCount: 3,
      maxPlayers: 4,
    });
  });

  it('says Join next mid-match, as the game list does: a joiner watches until the match ends', () => {
    expect(inviteAvailability(INVITE, [listed({ status: 'playing' })]).label).toBe('Join next');
    // Asking still says Ask; the host decides, whatever the match is doing.
    expect(inviteAvailability(INVITE, [listed({ status: 'playing' }, { joinByRequest: true })]).label).toBe('Ask');
  });

  it('says Ask for a room that asks to join — as the room is now, not as it was', () => {
    expect(inviteAvailability(INVITE, [listed({}, { joinByRequest: true })]).label).toBe('Ask');
  });

  it('says Full, and offers nothing, once the listed room has no seat', () => {
    expect(inviteAvailability(INVITE, [listed({ joinable: false, playerCount: 4 })])).toEqual({
      canJoin: false,
      label: 'Full',
      playerCount: 4,
      maxPlayers: 4,
    });
  });

  it('says Room closed when a listed room has left the game list', () => {
    expect(inviteAvailability(INVITE, [listed({ id: 'ZZZZ' })])).toEqual({
      canJoin: false,
      label: 'Room closed',
      playerCount: 1,
      maxPlayers: 4,
    });
  });

  it("keeps a private room's card joinable — it is never in the list, so absence says nothing", () => {
    expect(inviteAvailability({ ...INVITE, private: true }, [])).toEqual({
      canJoin: true,
      label: 'Join',
      playerCount: 1,
      maxPlayers: 4,
    });
    expect(inviteAvailability({ ...INVITE, private: true, joinByRequest: true }, []).label).toBe('Ask');
  });
});

describe('groupMessages with world-chat lines', () => {
  it('never puts an invite card under the same header as a typed line', () => {
    const typed = line();
    const invite = card();
    const groups = groupMessages([typed, invite]);
    expect(groups.map((g) => g.kind)).toEqual(['player', 'invite']);
    expect(groups[1]!.messages).toEqual([invite]);
  });

  it('groups consecutive lines from one sender, as in room chat', () => {
    const a = line();
    const b = line({ at: T0 + 1000 });
    expect(groupMessages([a, b])).toHaveLength(1);
  });
});
