import { afterEach, describe, expect, it } from 'vitest';
import { availableBytesFromMeminfo, cpuPercent, parseDeployStatus, ServerStatsSampler } from './serverStats.js';

const cpu = (idle: number, user: number) => [{ times: { idle, user, nice: 0, sys: 0, irq: 0 } }];

describe('server readings', () => {
  it('calculates CPU from two samples and rejects a missing interval', () => {
    expect(cpuPercent(cpu(100, 100), cpu(175, 125))).toBe(25);
    expect(cpuPercent(cpu(100, 100), cpu(100, 100))).toBeNull();
    expect(cpuPercent([], cpu(175, 125))).toBeNull();
  });

  it('uses Linux MemAvailable in KiB', () => {
    expect(availableBytesFromMeminfo('MemFree: 100 kB\nMemAvailable: 250 kB\n')).toBe(250 * 1024);
    expect(availableBytesFromMeminfo('MemFree: 100 kB')).toBeNull();
  });

  it('accepts only valid deploy status fields', () => {
    expect(parseDeployStatus(JSON.stringify({ sha: 'abcdef1234567', at: '2026-10-06T12:00:00Z', result: 'deployed', message: 'OK', durationMs: 8300 })))
      .toMatchObject({ sha: 'abcdef1234567', result: 'deployed', durationMs: 8300 });
    expect(parseDeployStatus('{bad')).toBeNull();
    expect(parseDeployStatus(JSON.stringify({ sha: 'oops', at: 1, result: 'deployed', durationMs: 1 }))).toBeNull();
  });
});

describe('sampler lifecycle', () => {
  const sampler = new ServerStatsSampler();
  afterEach(() => sampler.stop());

  it('returns finite machine and Node readings', async () => {
    await sampler.start();
    const result = await sampler.sample();
    expect(result.memoryTotalBytes).toBeGreaterThan(0);
    expect(result.memoryUsedBytes).toBeGreaterThanOrEqual(0);
    expect(result.heapTotalBytes).toBeGreaterThan(0);
    expect(result.rssBytes).toBeGreaterThan(0);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.processUptimeMs).toBeGreaterThan(0);
  });
});
