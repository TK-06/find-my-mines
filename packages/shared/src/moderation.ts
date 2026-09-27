import { isClassicConfig } from './rooms.js';
import type { RemovalNote, RemovalReason, RoomConfig, RoomOrigin } from './types.js';

type ModerationConfig = Pick<RoomConfig, 'rows' | 'cols' | 'mineCount' | 'maxPlayers' | 'mode'>;

/**
 * Kick and ban rules.
 *
 * Pure and shared, like room-config validation: the server runs these on every
 * request (never trust a client), and the client runs the same functions so the
 * dialog and the host's buttons agree with what the server will allow.
 */

/** In the order the dialog lists them, which is also the canonical order. */
export const REMOVAL_REASONS: readonly RemovalReason[] = [
  'afk',
  'offensive-name',
  'harassment',
  'cheating',
  'other',
];

export const REMOVAL_REASON_LABELS: Record<RemovalReason, string> = {
  afk: 'Inactive / AFK',
  'offensive-name': 'Offensive name',
  harassment: 'Harassment or spam',
  cheating: 'Cheating',
  other: 'Other',
};

export const MAX_REMARK_LENGTH = 200;

export type ParsedNote = { ok: true; note: RemovalNote } | { ok: false; error: string };

/**
 * Normalises an untrusted removal note. Unknown reasons are dropped rather than
 * rejected, but a note must still end up with a reason or a remark.
 */
export function parseRemovalNote(input: unknown): ParsedNote {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Say why this player is being removed.' };
  }

  const raw = input as { reasons?: unknown; remark?: unknown };
  const given = Array.isArray(raw.reasons) ? raw.reasons : [];
  const reasons = REMOVAL_REASONS.filter((reason) => given.includes(reason));
  const remark = typeof raw.remark === 'string' ? raw.remark.trim() : '';

  if (remark.length > MAX_REMARK_LENGTH) {
    return { ok: false, error: `Remarks can be at most ${MAX_REMARK_LENGTH} characters.` };
  }
  if (reasons.length === 0 && remark === '') {
    return { ok: false, error: 'Pick at least one reason or write a remark.' };
  }
  return { ok: true, note: { reasons, remark } };
}

/** One-line summary for logs and the removed player's page. */
export function describeReasons(note: RemovalNote): string {
  const parts = note.reasons.map((reason) => REMOVAL_REASON_LABELS[reason]);
  if (note.remark) parts.push(`"${note.remark}"`);
  return parts.join(' · ');
}

/**
 * Hosts may only moderate casual Custom rooms a player created. In a ranked
 * room a kick could cancel a match the host is losing; a matchmade room has no
 * host anyone chose; a Classic room keeps the original assignment rules.
 */
export function hostCanModerate(origin: RoomOrigin, config: ModerationConfig): boolean {
  return origin === 'created' && config.mode === 'casual' && !isClassicConfig(config);
}

export interface HostModerationContext {
  origin: RoomOrigin;
  config: ModerationConfig;
  actorId: string;
  hostId: string | null;
  targetId: string;
  targetInRoom: boolean;
}

/** Why a host's kick or ban is refused, or null when it is allowed. */
export function hostModerationError(ctx: HostModerationContext): string | null {
  if (ctx.actorId !== ctx.hostId) return 'Only the host can remove players.';
  if (!hostCanModerate(ctx.origin, ctx.config)) {
    return isClassicConfig(ctx.config)
      ? 'Classic rooms keep the original rules — hosts can remove players only in Custom rooms.'
      : 'Hosts can only remove players in casual rooms made with Create game.';
  }
  if (ctx.targetId === ctx.actorId) return 'You cannot remove yourself.';
  if (!ctx.targetInRoom) return 'That player is not in this room.';
  return null;
}
