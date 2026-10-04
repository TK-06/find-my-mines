import { describe, expect, it } from 'vitest';
import { ReportLimit } from './reportLimit.js';

const MIN = 60_000;

describe('ReportLimit', () => {
  it('lets a first report through', () => {
    expect(new ReportLimit().tryReport('a', 'x', 0)).toEqual({ ok: true });
  });

  it('refuses the same reporter and target inside the cooldown, and says how long is left', () => {
    const limit = new ReportLimit();
    limit.tryReport('a', 'x', 0);
    expect(limit.tryReport('a', 'x', 4 * MIN)).toEqual({ ok: false, why: 'same-target', waitMs: 6 * MIN });
    expect(limit.tryReport('a', 'x', 10 * MIN)).toEqual({ ok: true });
  });

  it('lets someone else report the same player', () => {
    const limit = new ReportLimit();
    limit.tryReport('a', 'x', 0);
    expect(limit.tryReport('b', 'x', 1)).toEqual({ ok: true });
  });

  it('caps the reports one reporter sends in the window', () => {
    const limit = new ReportLimit();
    for (let i = 0; i < 5; i++) expect(limit.tryReport('a', `t${i}`, i * 1000).ok).toBe(true);
    const sixth = limit.tryReport('a', 't5', 5000);
    // Room again when the oldest (sent at 0) is ten minutes old.
    expect(sixth).toEqual({ ok: false, why: 'too-many', waitMs: 10 * MIN - 5000 });
    // The first one ages out and makes room for exactly one more.
    expect(limit.tryReport('a', 't5', 10 * MIN).ok).toBe(true);
    expect(limit.tryReport('a', 't6', 10 * MIN).ok).toBe(false);
  });

  it('does not count a refused attempt', () => {
    const limit = new ReportLimit();
    limit.tryReport('a', 'x', 0);
    for (let i = 0; i < 10; i++) limit.tryReport('a', 'x', i);
    expect(limit.tryReport('a', 'y', 20).ok).toBe(true);
  });

  it('forgets everything once the windows pass', () => {
    const limit = new ReportLimit();
    limit.tryReport('a', 'x', 0);
    limit.tryReport('b', 'y', 0);
    limit.tryReport('c', 'z', 11 * MIN);
    expect(limit.size).toBe(2);
  });
});
