import { REPORT_KEEP_DAYS, type PlayerReport, type ReportStatus } from '@fmm/shared';

export const REPORT_KEEP_MS = REPORT_KEEP_DAYS * 24 * 60 * 60 * 1000;

/** The most reports held in memory; older ones are still in the database. */
export const REPORT_MEMORY_MAX = 500;

/**
 * The reports the server console shows: newest first, the last 90 days,
 * capped. This is the live copy the console reads; the database keeps the
 * durable one (persistence/reportRecorder.ts), so a restart loses nothing
 * once the table exists — and without it, reports still reach the console.
 *
 * Pure — the caller passes the clock in.
 */
export class ReportStore {
  private reports: PlayerReport[] = [];

  constructor(private readonly max = REPORT_MEMORY_MAX) {}

  add(report: PlayerReport): void {
    this.reports = [report, ...this.reports.filter((r) => r.id !== report.id)].slice(0, this.max);
  }

  /** Reports loaded back from the database at start-up, merged in by id. */
  addAll(reports: PlayerReport[]): void {
    const byId = new Map(this.reports.map((r) => [r.id, r]));
    for (const report of reports) if (!byId.has(report.id)) byId.set(report.id, report);
    this.reports = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, this.max);
  }

  /** Newest first. A copy, so nobody edits the store by accident. */
  list(): PlayerReport[] {
    return this.reports.map((r) => ({ ...r }));
  }

  get(id: string): PlayerReport | undefined {
    return this.reports.find((r) => r.id === id);
  }

  /** The changed report, or undefined when there is no such report. */
  setStatus(id: string, status: ReportStatus, now: number): PlayerReport | undefined {
    const report = this.reports.find((r) => r.id === id);
    if (!report) return undefined;
    report.status = status;
    report.handledAt = status === 'open' ? null : now;
    return { ...report };
  }

  /** Drops reports older than the keep period; returns how many went. */
  prune(now: number, keepMs = REPORT_KEEP_MS): number {
    const before = this.reports.length;
    this.reports = this.reports.filter((r) => now - r.createdAt < keepMs);
    return before - this.reports.length;
  }

  get size(): number {
    return this.reports.length;
  }
}
