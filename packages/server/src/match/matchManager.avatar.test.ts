import { CLASSIC_PRESET, type Identity } from '@fmm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchManager, type MatchBroadcaster } from './matchManager.js';

const quiet: MatchBroadcaster = {
  matchStart: () => {},
  cellRevealed: () => {},
  turnChanged: () => {},
  turnTick: () => {},
  matchEnded: () => {},
  matchReset: () => {},
  stateSync: () => {},
  matchForfeited: () => {},
  notice: () => {},
  error: () => {},
  changed: () => {},
};

const PICTURE = 'https://abc.supabase.co/storage/v1/object/public/avatars/u1/1.webp';

function identity(nickname: string, avatarUrl?: string | null): Identity {
  return { profileId: null, nickname, elo: 800, gamesPlayed: 0, isGuest: true, avatarUrl };
}

let room: MatchManager | null = null;

afterEach(() => {
  room?.shutdown();
  room = null;
});

describe('profile pictures on seats', () => {
  it('shows a player’s picture on their seat', () => {
    room = new MatchManager('R1', 'Pictures', { ...CLASSIC_PRESET }, 'created', quiet);
    room.addPlayer('a', { ...identity('Ann', PICTURE), profileId: 'u1', isGuest: false });

    expect(room.publicState().players[0]!.avatarUrl).toBe(PICTURE);
  });

  it('leaves the field off a seat with no picture, so it serialises as before', () => {
    room = new MatchManager('R1', 'Pictures', { ...CLASSIC_PRESET }, 'created', quiet);
    room.addPlayer('a', identity('Ann'));
    room.addPlayer('b', identity('Ben', null));

    for (const player of room.publicState().players) expect('avatarUrl' in player).toBe(false);
  });

  it('keeps the picture when a spectator is moved into a free seat', () => {
    room = new MatchManager('R1', 'Pictures', { ...CLASSIC_PRESET }, 'created', quiet);
    room.addPlayer('a', identity('Ann'));
    room.addPlayer('b', identity('Ben'));
    room.addSpectator('c', identity('Cat', PICTURE));
    room.remove('b');
    room.resetAll(); // promotes waiting spectators into free seats

    const cat = room.publicState().players.find((p) => p.id === 'c');
    expect(cat?.avatarUrl).toBe(PICTURE);
  });

  it('gives the computer no picture', () => {
    room = new MatchManager('R1', 'Pictures', { ...CLASSIC_PRESET, maxPlayers: 2 }, 'ai', quiet);
    room.addPlayer('a', identity('Ann', PICTURE));
    room.addBot('bot', { level: 'easy', model: 'ai' });

    const bot = room.publicState().players.find((p) => p.id === 'bot');
    expect(bot && 'avatarUrl' in bot).toBe(false);
  });
});
