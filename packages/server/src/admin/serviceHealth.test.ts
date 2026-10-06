import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthOutcome, ServiceHealthChecker } from './serviceHealth.js';

describe('service health', () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  afterEach(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });

  it('distinguishes API health from a host-only reachability check', () => {
    expect(healthOutcome(204)).toEqual({ ok: true, error: null });
    expect(healthOutcome(401)).toEqual({ ok: false, error: 'HTTP 401' });
    expect(healthOutcome(405, true)).toEqual({ ok: true, error: null });
    expect(healthOutcome(503, true)).toEqual({ ok: false, error: 'HTTP 503' });
  });

  it('keeps optional services unconfigured without making requests', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const doFetch = vi.fn(async () => { throw new Error('unexpected request'); }) as unknown as typeof fetch;
    const result = await new ServiceHealthChecker().check(doFetch);
    expect(result.services.find((service) => service.name === 'game')?.status).toBe('ok');
    expect(result.services.find((service) => service.name === 'supabase')?.status).toBe('not-configured');
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('checks Supabase without exposing the key in status', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-private-key';
    const doFetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const result = await new ServiceHealthChecker().check(doFetch);
    const supabase = result.services.find((service) => service.name === 'supabase');
    expect(supabase).toMatchObject({ status: 'down', error: 'HTTP 401' });
    expect(JSON.stringify(supabase)).not.toContain('test-private-key');
    expect(doFetch).toHaveBeenCalledWith('https://example.supabase.co/auth/v1/health', expect.objectContaining({ headers: { apikey: 'test-private-key' } }));
  });
});
