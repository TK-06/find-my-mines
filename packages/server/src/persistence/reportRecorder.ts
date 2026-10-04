import {
  isReportReason,
  isReportStatus,
  REPORT_KEEP_DAYS,
  type PlayerReport,
  type ReportParty,
  type ReportStatus,
} from '@fmm/shared';
import { admin } from '../supabase.js';

/**
 * Player reports in Supabase (migration 0005). The server writes them with the
 * service role; nothing else can read or write the table.
 *
 * Best-effort, like the match recorder: a report always reaches the live
 * console from memory first, and a database that is down, unconfigured or
 * missing the table is logged once and otherwise ignored.
 */

let missingTableLogged = false;

function failed(what: string, error: { code?: string; message: string }): void {
  // PGRST205 / 42P01: the table is not there — migration 0005 has not run.
  if (error.code === 'PGRST205' || error.code === '42P01') {
    if (!missingTableLogged) {
      missingTableLogged = true;
      console.warn('[reports] no reports table yet — run supabase/migrations/0005_reports.sql. Reports stay in memory.');
    }
    return;
  }
  console.error(`[reports] could not ${what}:`, error.message);
}

interface ReportRow {
  id: string;
  created_at: string;
  reason: string;
  details: string;
  room_id: string | null;
  status: string;
  handled_at: string | null;
  reporter: ReportParty;
  target: ReportParty & { clientId: string };
}

function toRow(report: PlayerReport): ReportRow {
  return {
    id: report.id,
    created_at: new Date(report.createdAt).toISOString(),
    reason: report.reason,
    details: report.details,
    room_id: report.roomId,
    status: report.status,
    handled_at: report.handledAt === null ? null : new Date(report.handledAt).toISOString(),
    reporter: report.reporter,
    target: report.target,
  };
}

/** A row read back, or null when it does not look like one of ours. */
export function fromRow(row: Partial<ReportRow>): PlayerReport | null {
  const createdAt = Date.parse(String(row.created_at));
  if (typeof row.id !== 'string' || !Number.isFinite(createdAt)) return null;
  if (!isReportReason(row.reason) || !isReportStatus(row.status)) return null;
  if (typeof row.reporter !== 'object' || row.reporter === null) return null;
  if (typeof row.target !== 'object' || row.target === null) return null;
  const handled = row.handled_at ? Date.parse(row.handled_at) : NaN;
  return {
    id: row.id,
    createdAt,
    reason: row.reason,
    details: typeof row.details === 'string' ? row.details : '',
    roomId: typeof row.room_id === 'string' ? row.room_id : null,
    reporter: row.reporter,
    target: row.target,
    status: row.status,
    handledAt: Number.isFinite(handled) ? handled : null,
  };
}

export async function saveReport(report: PlayerReport): Promise<void> {
  const db = admin;
  if (!db) return;
  try {
    const { error } = await db.from('reports').insert(toRow(report));
    if (error) failed('save a report', error);
  } catch (error) {
    console.error('[reports] could not save a report:', error);
  }
}

export async function saveReportStatus(id: string, status: ReportStatus, handledAt: number | null): Promise<void> {
  const db = admin;
  if (!db) return;
  try {
    const { error } = await db
      .from('reports')
      .update({ status, handled_at: handledAt === null ? null : new Date(handledAt).toISOString() })
      .eq('id', id);
    if (error) failed('update a report', error);
  } catch (error) {
    console.error('[reports] could not update a report:', error);
  }
}

/** The last 90 days of reports, newest first, for the console after a restart. */
export async function loadRecentReports(limit = 500): Promise<PlayerReport[]> {
  const db = admin;
  if (!db) return [];
  try {
    const since = new Date(Date.now() - REPORT_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from('reports')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      failed('load reports', error);
      return [];
    }
    return ((data ?? []) as Partial<ReportRow>[]).flatMap((row) => fromRow(row) ?? []);
  } catch (error) {
    console.error('[reports] could not load reports:', error);
    return [];
  }
}

/** Deletes reports past the keep period. Run at start-up and once a day. */
export async function deleteOldReports(): Promise<void> {
  const db = admin;
  if (!db) return;
  try {
    const cutoff = new Date(Date.now() - REPORT_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await db.from('reports').delete().lt('created_at', cutoff);
    if (error) failed('delete old reports', error);
  } catch (error) {
    console.error('[reports] could not delete old reports:', error);
  }
}
