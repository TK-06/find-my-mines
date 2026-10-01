import { describe, expect, it } from 'vitest';
import type { LobbyMessage, RoomConfig, RoomSummary } from '@fmm/shared';
import {
  LOBBY_HISTORY_LIMIT,
  LOBBY_INVITE_COOLDOWN_MS,
  LobbyChat,
  inviteFor,
  inviteLine,
  inviteRefusal,
  lobbyInviteLimit,
  playerLine,
} from './lobbyChat.js';

const CONFIG: RoomConfig = { rows: 6, cols: 6, mineCount: 8, maxPlayers: 4, mode: 'casual' };

const room = (over: Partial<RoomSummary> = {}, config: Partial<RoomConfig> = {}): RoomSummary => ({
  id: 'ABCD',
  name: 'Friday night',
  hostNickname: 'Alice',
  config: { ...CONFIG, ...config },
  playerCount: 1,
  spectatorCount: 0,
  status: 'waiting',
  createdAt: 0,
  joinable: true,
  ...over,
});

const ALICE = { nickname: 'Alice', isGuest: true };
const meta = (id = 'm1', at = 1_000) => ({ id, fromId: 'sock-alice', sender: ALICE, at });

let seq = 0;
const line = (text = 'hi'): LobbyMessage => playerLine(meta(`m${seq++}`), text);

describe('LobbyChat', () => {
  it(`keeps the last ${LOBBY_HISTORY_LIMIT} lines for newcomers`, () => {
    expect(LOBBY_HISTORY_LIMIT).toBe(50);
    const chat = new LobbyChat();
    const sent = Array.from({ length: LOBBY_HISTORY_LIMIT + 7 }, (_, i) => line(`line ${i}`));
    for (const message of sent) chat.add(message);
    expect(chat.size).toBe(LOBBY_HISTORY_LIMIT);
    expect(chat.history()).toEqual(sent.slice(-LOBBY_HISTORY_LIMIT));
  });

  it('gives history oldest first', () => {
    const chat = new LobbyChat();
    const first = line('first');
    const second = line('second');
    chat.add(first);
    chat.add(second);
    expect(chat.history()).toEqual([first, second]);
  });

  it('hands out a copy, so a caller cannot change what the next newcomer sees', () => {
    const chat = new LobbyChat();
    chat.add(line());
    chat.history().length = 0;
    expect(chat.size).toBe(1);
  });

  it('empties on clear and says how many lines went', () => {
    const chat = new LobbyChat();
    chat.add(line());
    chat.add(line());
    expect(chat.clear()).toBe(2);
    expect(chat.history()).toEqual([]);
    expect(chat.clear()).toBe(0);
  });
});

describe('playerLine', () => {
  it('builds a player line from the sender the server verified', () => {
    expect(playerLine(meta('id-1', 42), 'hello')).toEqual({
      id: 'id-1',
      fromId: 'sock-alice',
      fromName: 'Alice',
      isGuest: true,
      fromAvatarUrl: null,
      kind: 'player',
      text: 'hello',
      at: 42,
    });
  });

  it("carries the account's picture when it has one", () => {
    const withPicture = { ...meta(), sender: { nickname: 'Bo', isGuest: false, avatarUrl: 'https://x/bo.png' } };
    const message = playerLine(withPicture, 'hey');
    expect(message.fromAvatarUrl).toBe('https://x/bo.png');
    expect(message.isGuest).toBe(false);
  });
});

describe('inviteFor', () => {
  it('describes the room as the card shows it', () => {
    expect(inviteFor(room({ playerCount: 2 }))).toEqual({
      roomId: 'ABCD',
      roomName: 'Friday night',
      rows: 6,
      cols: 6,
      mineCount: 8,
      playerCount: 2,
      maxPlayers: 4,
      mode: 'casual',
      joinByRequest: false,
    });
  });

  it('says when the room asks to join, and when it is private', () => {
    const invite = inviteFor(room({}, { joinByRequest: true, private: true, maxPlayers: null }));
    expect(invite.joinByRequest).toBe(true);
    expect(invite.private).toBe(true);
    expect(invite.maxPlayers).toBeNull();
  });

  it('leaves the private flag out for a listed room', () => {
    expect('private' in inviteFor(room())).toBe(false);
  });
});

describe('inviteLine', () => {
  it('is an invite card saying who invited everyone where', () => {
    const message = inviteLine(meta('id-2', 7), room());
    expect(message).toMatchObject({
      id: 'id-2',
      fromId: 'sock-alice',
      fromName: 'Alice',
      kind: 'invite',
      text: 'Alice invited everyone to Friday night',
      at: 7,
      invite: { roomId: 'ABCD', roomName: 'Friday night' },
    });
  });
});

describe('inviteRefusal', () => {
  const seatedHost = { room: room(), seated: true, isHost: true };

  it('lets a seated player advertise a room with a free seat', () => {
    expect(inviteRefusal(seatedHost)).toBeNull();
    expect(inviteRefusal({ ...seatedHost, isHost: false })).toBeNull();
  });

  it('refuses someone who is not in a room', () => {
    expect(inviteRefusal({ room: null, seated: false, isHost: false })).toMatch(/room first/i);
  });

  it('refuses a spectator — only players advertise their table', () => {
    expect(inviteRefusal({ room: room(), seated: false, isHost: false })).toMatch(/players/i);
  });

  it('refuses a full room: nobody reading the card could join', () => {
    expect(inviteRefusal({ ...seatedHost, room: room({ joinable: false, playerCount: 4 }) })).toMatch(/full/i);
  });

  it("lets only the host post a private room's code in public", () => {
    const secret = room({}, { private: true });
    expect(inviteRefusal({ room: secret, seated: true, isHost: false })).toMatch(/host/i);
    expect(inviteRefusal({ room: secret, seated: true, isHost: true })).toBeNull();
  });
});

describe('lobbyInviteLimit', () => {
  it('lets one invite through every 30 seconds per connection', () => {
    expect(LOBBY_INVITE_COOLDOWN_MS).toBe(30_000);
    const limit = lobbyInviteLimit();
    expect(limit.trySend('ana', 0)).toBe(0);
    expect(limit.trySend('ana', 10_000)).toBe(20_000);
    expect(limit.trySend('bo', 10_000)).toBe(0);
    expect(limit.trySend('ana', 30_000)).toBe(0);
  });
});
