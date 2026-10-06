import type { AdminServiceCheck, AdminServiceHealth } from '@fmm/shared';
import { JEV_URL } from '../ai/jev.js';
import { GROQ_API_KEY, GROQ_COACH_API_KEY, JEV_API_KEY } from '../config.js';

type ServiceName = AdminServiceCheck['name'];
type Fetcher = typeof fetch;

export function healthOutcome(status: number, hostOnly = false): { ok: boolean; error: string | null } {
  // JEV's inference endpoint accepts POST only. A 404/405 from its host still
  // proves reachability, but the UI labels this as a host check, not API health.
  const ok = hostOnly ? status < 500 : status >= 200 && status < 300;
  return { ok, error: ok ? null : `HTTP ${status}` };
}

export class ServiceHealthChecker {
  private lastOk = new Map<ServiceName, number>();

  async check(doFetch: Fetcher = fetch): Promise<AdminServiceHealth> {
    const checkedAt = Date.now();
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const groqKey = GROQ_API_KEY || GROQ_COACH_API_KEY;
    const services = await Promise.all([
      Promise.resolve<AdminServiceCheck>({ name: 'game', status: 'ok', latencyMs: 0, lastOkAt: checkedAt, error: null, checkedAt }),
      this.probe('supabase', Boolean(supabaseUrl && supabaseKey),
        () => `${new URL(supabaseUrl!).origin}/auth/v1/health`,
        { headers: { apikey: supabaseKey ?? '' } }, doFetch),
      this.probe('groq', Boolean(groqKey),
        () => 'https://api.groq.com/openai/v1/models',
        { headers: { Authorization: `Bearer ${groqKey}` } }, doFetch),
      this.probe('jev', Boolean(JEV_API_KEY),
        () => new URL(JEV_URL).origin,
        { method: 'HEAD' }, doFetch, true),
    ]);
    return { checkedAt, services };
  }

  private async probe(
    name: ServiceName,
    configured: boolean,
    url: () => string,
    init: RequestInit,
    doFetch: Fetcher,
    hostOnly = false,
  ): Promise<AdminServiceCheck> {
    const checkedAt = Date.now();
    if (!configured) return { name, status: 'not-configured', latencyMs: null, lastOkAt: this.lastOk.get(name) ?? null, error: null, checkedAt };
    const started = performance.now();
    try {
      const response = await doFetch(url(), { ...init, signal: AbortSignal.timeout(3000) });
      const outcome = healthOutcome(response.status, hostOnly);
      if (outcome.ok) this.lastOk.set(name, Date.now());
      return {
        name,
        status: outcome.ok ? 'ok' : 'down',
        latencyMs: Math.round(performance.now() - started),
        lastOkAt: this.lastOk.get(name) ?? null,
        error: outcome.error,
        checkedAt,
      };
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return {
        name,
        status: 'down',
        latencyMs: null,
        lastOkAt: this.lastOk.get(name) ?? null,
        error: timedOut ? 'Timed out after 3 s' : 'Network or configuration error',
        checkedAt,
      };
    }
  }
}
