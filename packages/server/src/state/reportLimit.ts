import {
  REPORT_BURST_MAX,
  REPORT_BURST_WINDOW_MS,
  REPORT_PAIR_COOLDOWN_MS,
} from '@fmm/shared';

export type ReportVerdict =
  | { ok: true }
  | { ok: false; why: 'same-target' | 'too-many'; waitMs: number };

/**
 * Keeps one reporter from burying the console: the same player once per ten
 * minutes, and five reports in all per ten minutes.
 *
 * Keys are whatever identifies the people best (an account id, else a guest
 * id, else a tab's session id), so a second tab of the same account gets no
 * fresh allowance. Pure — the caller passes the clock in.
 */
export class ReportLimit {
  /** When each reporter → target pair last got a report through. */
  private readonly pairs = new Map<string, number>();
  /** When each reporter's recent reports went through, oldest first. */
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly pairCooldownMs = REPORT_PAIR_COOLDOWN_MS,
    private readonly burstMax = REPORT_BURST_MAX,
    private readonly burstWindowMs = REPORT_BURST_WINDOW_MS,
  ) {}

  /** Records the report and says ok — or records nothing and says how long to wait. */
  tryReport(reporter: string, target: string, now: number): ReportVerdict {
    this.forgetOld(now);

    const pair = JSON.stringify([reporter, target]);
    const last = this.pairs.get(pair);
    if (last !== undefined) return { ok: false, why: 'same-target', waitMs: this.pairCooldownMs - (now - last) };

    const times = this.recent.get(reporter) ?? [];
    if (times.length >= this.burstMax) {
      return { ok: false, why: 'too-many', waitMs: this.burstWindowMs - (now - times[0]!) };
    }

    this.pairs.set(pair, now);
    this.recent.set(reporter, [...times, now]);
    return { ok: true };
  }

  /** Entries still counting against someone. */
  get size(): number {
    return this.pairs.size + this.recent.size;
  }

  private forgetOld(now: number): void {
    for (const [key, at] of this.pairs) {
      if (now - at >= this.pairCooldownMs) this.pairs.delete(key);
    }
    for (const [key, times] of this.recent) {
      const kept = times.filter((at) => now - at < this.burstWindowMs);
      if (kept.length === 0) this.recent.delete(key);
      else this.recent.set(key, kept);
    }
  }
}
