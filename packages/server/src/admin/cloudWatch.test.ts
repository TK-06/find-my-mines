import { describe, expect, it, vi } from 'vitest';
import { cloudErrorReason, instanceIdentity, metricPoints } from './cloudWatch.js';

describe('CloudWatch mapping', () => {
  it('sorts unsorted datapoints and ignores incomplete values', () => {
    const rows = [
      { Timestamp: new Date('2026-10-06T12:10:00Z'), Average: 32 },
      { Timestamp: new Date('2026-10-06T12:00:00Z'), Average: 18 },
      { Timestamp: new Date('2026-10-06T12:05:00Z') },
    ];
    expect(metricPoints(rows, 'Average')).toEqual([
      { at: Date.parse('2026-10-06T12:00:00Z'), value: 18 },
      { at: Date.parse('2026-10-06T12:10:00Z'), value: 32 },
    ]);
  });

  it('uses IMDSv2 token and validates EC2 identity', async () => {
    const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/token')) return new Response('token');
      expect(init?.headers).toEqual({ 'X-aws-ec2-metadata-token': 'token' });
      return new Response(url.endsWith('/instance-id') ? 'i-1234567890abcdef0' : 'ap-southeast-2');
    }) as unknown as typeof fetch;
    expect(await instanceIdentity(doFetch)).toEqual({ instanceId: 'i-1234567890abcdef0', region: 'ap-southeast-2' });
    expect(doFetch).toHaveBeenCalledTimes(3);
    expect(doFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/token'), expect.objectContaining({ method: 'PUT' }));
  });

  it('returns no identity when the token endpoint fails', async () => {
    const doFetch = vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    expect(await instanceIdentity(doFetch)).toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('maps access and credential failures to safe operator messages', () => {
    const denied = new Error('secret text'); denied.name = 'AccessDeniedException';
    const missing = new Error('secret text'); missing.name = 'CredentialsProviderError';
    expect(cloudErrorReason(denied)).toContain('cloudwatch:GetMetricStatistics');
    expect(cloudErrorReason(missing)).toBe('No IAM role attached');
    expect(cloudErrorReason(new Error('secret text'))).not.toContain('secret text');
  });
});
