import { describe, expect, it } from 'vitest';
import { presenceOf } from './presence.js';

describe('presenceOf', () => {
  it('is lobby when the player is in no room and no queue', () => {
    expect(presenceOf({ inQueue: false, roomId: null, seat: 'spectator', roomStatus: null })).toBe('lobby');
  });

  it('is queue while matchmaking', () => {
    expect(presenceOf({ inQueue: true, roomId: null, seat: 'spectator', roomStatus: null })).toBe('queue');
  });

  it('is room for a seated player whose room is waiting', () => {
    expect(presenceOf({ inQueue: false, roomId: 'ABCD', seat: 'player', roomStatus: 'waiting' })).toBe('room');
  });

  it('is room for a seated player on the end-of-match screen', () => {
    expect(presenceOf({ inQueue: false, roomId: 'ABCD', seat: 'player', roomStatus: 'ended' })).toBe('room');
  });

  it('is playing for a seated player in a live match', () => {
    expect(presenceOf({ inQueue: false, roomId: 'ABCD', seat: 'player', roomStatus: 'playing' })).toBe('playing');
  });

  it('is watching for a spectator, whatever the match status', () => {
    expect(presenceOf({ inQueue: false, roomId: 'ABCD', seat: 'spectator', roomStatus: 'playing' })).toBe('watching');
    expect(presenceOf({ inQueue: false, roomId: 'ABCD', seat: 'spectator', roomStatus: 'waiting' })).toBe('watching');
  });
});
