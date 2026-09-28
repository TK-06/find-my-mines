import { describe, expect, it } from 'vitest';
import { nextInTurn } from './turns.js';

describe('nextInTurn', () => {
  it('alternates between two players', () => {
    const order = ['alice', 'bob'];
    expect(nextInTurn(order, 'alice')).toBe('bob');
    expect(nextInTurn(order, 'bob')).toBe('alice');
  });

  it('walks a free-for-all room in turn order', () => {
    const order = ['alice', 'bob', 'carol', 'dave'];
    expect(nextInTurn(order, 'alice')).toBe('bob');
    expect(nextInTurn(order, 'bob')).toBe('carol');
    expect(nextInTurn(order, 'carol')).toBe('dave');
  });

  it('wraps from the last player back to the first', () => {
    expect(nextInTurn(['alice', 'bob', 'carol'], 'carol')).toBe('alice');
  });

  it('is null when nobody is on turn', () => {
    expect(nextInTurn(['alice', 'bob', 'carol'], null)).toBeNull();
  });

  it('is null when the player on turn is not in the order', () => {
    expect(nextInTurn(['alice', 'bob', 'carol'], 'mallory')).toBeNull();
  });

  it('is null with fewer than two players, since nobody else can be next', () => {
    expect(nextInTurn(['alice'], 'alice')).toBeNull();
    expect(nextInTurn([], null)).toBeNull();
    expect(nextInTurn([], 'alice')).toBeNull();
  });
});
