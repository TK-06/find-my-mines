import { describe, expect, it } from 'vitest';
import { CHAT_BURST, CHAT_WINDOW_MS, ChatLimit } from './chatLimit.js';

/** Sends `count` lines at `at` and returns what each attempt answered. */
function sendMany(limit: ChatLimit, who: string, count: number, at: number): number[] {
  return Array.from({ length: count }, () => limit.trySend(who, at));
}

describe('ChatLimit', () => {
  it('allows five lines in any ten seconds', () => {
    expect(CHAT_BURST).toBe(5);
    expect(CHAT_WINDOW_MS).toBe(10_000);
  });

  it('lets a burst of five through', () => {
    expect(sendMany(new ChatLimit(), 'ana', 5, 0)).toEqual([0, 0, 0, 0, 0]);
  });

  it('refuses the sixth inside the window, saying how long until the oldest line ages out', () => {
    const limit = new ChatLimit();
    limit.trySend('ana', 1_000);
    sendMany(limit, 'ana', 4, 3_000);
    expect(limit.trySend('ana', 4_000)).toBe(7_000);
  });

  it('frees one slot as each old line ages out — a sliding window, not a fixed bucket', () => {
    const limit = new ChatLimit();
    limit.trySend('ana', 0);
    sendMany(limit, 'ana', 4, 5_000);
    expect(limit.trySend('ana', 10_000)).toBe(0);
    expect(limit.trySend('ana', 10_001)).toBeGreaterThan(0);
  });

  it('does not count a refused line — spamming Enter buys nothing, but costs nothing either', () => {
    const limit = new ChatLimit();
    sendMany(limit, 'ana', 5, 0);
    sendMany(limit, 'ana', 20, 9_000);
    expect(limit.trySend('ana', 10_000)).toBe(0);
  });

  it('keeps each connection to its own allowance', () => {
    const limit = new ChatLimit();
    sendMany(limit, 'ana', 5, 0);
    expect(limit.trySend('ben', 1)).toBe(0);
  });

  it('forgets a connection that has gone', () => {
    const limit = new ChatLimit();
    sendMany(limit, 'ana', 5, 0);
    limit.forget('ana');
    expect(limit.size).toBe(0);
    expect(limit.trySend('ana', 1)).toBe(0);
  });

  it('drops quiet connections, so a long-running server does not grow', () => {
    const limit = new ChatLimit(2, 1_000);
    limit.trySend('ana', 0);
    limit.trySend('ben', 0);
    expect(limit.size).toBe(2);
    limit.trySend('cy', 5_000);
    expect(limit.size).toBe(1);
  });
});
