/**
 * Player reports: what a report may say, and the shape the server keeps.
 *
 * Pure and shared, like the moderation rules: the server parses every report
 * with these (never trust a client), and the report dialog runs the same
 * function so Send is only offered when the server would accept it.
 */

/** In the order the dialog lists them. */
export const REPORT_REASONS = ['offensive-name', 'harassment', 'cheating', 'spam', 'other'] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  'offensive-name': 'Offensive name or picture',
  harassment: 'Harassment in chat',
  cheating: 'Cheating or abusing a bug',
  spam: 'Spam in world chat',
  other: 'Something else',
};

/** The optional details box. "Something else" needs at least a few words in it. */
export const REPORT_DETAILS_MAX = 300;

/** How long a report is kept, in memory and in the database, before it is deleted. */
export const REPORT_KEEP_DAYS = 90;

/** One reporter may report the same player once in this window. */
export const REPORT_PAIR_COOLDOWN_MS = 10 * 60_000;

/** And at most this many reports in all, per reporter, per window. */
export const REPORT_BURST_MAX = 5;
export const REPORT_BURST_WINDOW_MS = 10 * 60_000;

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/**
 * A guest's random id, as the browser makes it: 16 random bytes in hex. The
 * server keeps one only if it looks exactly like this.
 */
export function isGuestId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/**
 * One side of a report as the server saw it. Everything here comes from the
 * server's own records of the connection, never from the report itself.
 */
export interface ReportParty {
  nickname: string;
  /** The account, for a signed-in player. The one identifier a player cannot fake. */
  profileId: string | null;
  isGuest: boolean;
  /** The random id in a guest's fmm_guest cookie. Clearable, so a hint, not proof. */
  guestId: string | null;
  /** The browser tab's session id. */
  sessionId: string | null;
  /** The IP address the connection came from (through the tunnel, the visitor's own). */
  address: string;
}

export interface PlayerReport {
  id: string;
  createdAt: number;
  reason: ReportReason;
  details: string;
  /** The room either of them was in when it was sent, if any — the reported player's first. */
  roomId: string | null;
  reporter: ReportParty;
  /** The reported player, plus their connection id while it lasts (for Kick / Ban). */
  target: ReportParty & { clientId: string };
  status: ReportStatus;
  /** When an admin resolved or dismissed it. */
  handledAt: number | null;
}

export type ParsedReport =
  | { ok: true; targetId: string; reason: ReportReason; details: string }
  | { ok: false; error: string };

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

/**
 * Normalises an untrusted report. The details are trimmed and their runs of
 * whitespace folded, so a wall of blank lines cannot reach the console.
 */
export function parseReport(input: unknown): ParsedReport {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Pick a reason for the report.' };
  }
  const raw = input as { targetId?: unknown; reason?: unknown; details?: unknown };

  const targetId = typeof raw.targetId === 'string' ? raw.targetId : '';
  if (targetId.length === 0 || targetId.length > 64) {
    return { ok: false, error: 'That player is no longer online.' };
  }
  if (!isReportReason(raw.reason)) return { ok: false, error: 'Pick a reason for the report.' };

  const details = typeof raw.details === 'string' ? raw.details.replace(/\s+/g, ' ').trim() : '';
  if (details.length > REPORT_DETAILS_MAX) {
    return { ok: false, error: `Details can be at most ${REPORT_DETAILS_MAX} characters.` };
  }
  if (raw.reason === 'other' && details.length < 3) {
    return { ok: false, error: 'Say what happened in the details box.' };
  }
  return { ok: true, targetId, reason: raw.reason, details };
}

/** Admins may move a report to any status, open included (to undo a mistake). */
export function isReportStatus(value: unknown): value is ReportStatus {
  return value === 'open' || value === 'resolved' || value === 'dismissed';
}

/** One line for the console's log: "Bob reported Eve — Harassment in chat". */
export function describeReport(report: Pick<PlayerReport, 'reason' | 'reporter' | 'target'>): string {
  return `${report.reporter.nickname} reported ${report.target.nickname} — ${REPORT_REASON_LABELS[report.reason]}`;
}
