import type { LogLine } from '@fmm/shared';
import { describe, expect, it } from 'vitest';
import { ActivityLog } from './activityLog.js';

describe('ActivityLog', () => {
  it('numbers lines in the order they were added', () => {
    const log = new ActivityLog();
    const first = log.add('connection', 'a');
    const second = log.add('room', 'b');
    expect(second.id).toBeGreaterThan(first.id);
  });

  it('stamps each line with the injected clock', () => {
    const log = new ActivityLog(undefined, 200, () => 1234);
    expect(log.add('player', 'x').at).toBe(1234);
  });

  it('hands every new line to the listener', () => {
    const seen: LogLine[] = [];
    const log = new ActivityLog((line) => seen.push(line));
    log.add('connection', 'hello');
    expect(seen.map((l) => l.text)).toEqual(['hello']);
  });

  it('keeps at most `capacity` event lines, dropping the oldest', () => {
    const log = new ActivityLog(undefined, 3);
    for (const text of ['1', '2', '3', '4']) log.add('room', text);
    expect(log.recent().map((l) => l.text)).toEqual(['2', '3', '4']);
  });

  it('gives traffic its own budget, so a burst of moves cannot evict connection events', () => {
    const log = new ActivityLog(undefined, 3);
    log.add('connection', 'Alice connected');
    for (let i = 0; i < 10; i++) log.add('traffic', `move ${i}`);
    const texts = log.recent().map((l) => l.text);
    expect(texts).toContain('Alice connected');
    expect(texts.filter((t) => t.startsWith('move'))).toEqual(['move 7', 'move 8', 'move 9']);
  });

  it('returns both kinds interleaved in the order they happened', () => {
    const log = new ActivityLog();
    log.add('connection', 'a');
    log.add('traffic', 'b');
    log.add('room', 'c');
    expect(log.recent().map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });
});
