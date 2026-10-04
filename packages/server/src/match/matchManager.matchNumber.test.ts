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

const guest = (nickname: string): Identity => ({ profileId: null, nickname, elo: 800, gamesPlayed: 0, isGuest: true });

let room: MatchManager | null = null;

afterEach(() => {
  room?.shutdown();
  room = null;
});

describe('matchNumber', () => {
  it('counts the matches a room has started, so something begun in one cannot land in the next', () => {
    room = new MatchManager('R1', 'Hints', { ...CLASSIC_PRESET, maxPlayers: 2 }, 'ai', quiet);
    room.addPlayer('a', guest('Ann'));
    room.addBot('bot', { level: 'easy', model: 'ai' });
    expect(room.matchNumber).toBe(0);

    room.start('a');
    expect(room.matchNumber).toBe(1);

    // A hint inside the match does not start another.
    room.spendHint('a');
    expect(room.matchNumber).toBe(1);

    // The console's Reset empties the room; the next start is a new match.
    room.resetAll();
    expect(room.matchNumber).toBe(1);
    room.start('a');
    expect(room.matchNumber).toBe(2);
  });
});
