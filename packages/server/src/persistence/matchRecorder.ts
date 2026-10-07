import { randomUUID } from 'node:crypto';
import type { Replay } from '@fmm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinishedMatch } from '../match/matchManager.js';
import { admin } from '../supabase.js';

/** What the recorder needs from the database client, so a test can hand it a stand-in. */
type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

type DbError = { code?: string; message: string };

export interface RecordOptions {
  /** How long to wait before the one retry of a failed insert. Injectable so a test need not sit through it. */
  retryDelayMs?: number;
  /**
   * Where a lost replay, or a match that could not be saved, is announced: one
   * line of plain text. The server passes its console log; by default it goes
   * to the process's own console.
   */
  report?: (text: string) => void;
}

/** Long enough to ride out a network blip or a cold database, short enough not to hold up the result. */
const RETRY_DELAY_MS = 250;

/**
 * Writes a finished match to Supabase and applies rating changes.
 *
 * Persistence is best-effort by design: if Supabase is down or unconfigured the
 * match still finished correctly in memory and players already saw their
 * result. A failed write is logged, never thrown — losing a history row must
 * not take the game server down mid-demo.
 *
 * The replay (the mines and the order the cells were opened) is saved with the
 * match, in a column migration 0006 adds. It is only dropped when the database
 * itself refuses it — no such column yet, or over the size check. Any other
 * failure (a network blip, a timeout, a cold database) is tried once more with
 * the replay, since losing it for good over a hiccup is what made some games
 * impossible to review from the game log. Only if that fails too is the match
 * saved without its replay — and that is said out loud, never silently.
 *
 * The match id is chosen here, not by the database, so a second try can never
 * leave two rows: if the first one landed after all (the answer was lost), the
 * second finds it already there and counts as saved.
 *
 * Returns the saved match's id, or null when nothing was written.
 */
export async function recordMatch(
  match: FinishedMatch,
  replay: Replay | null = null,
  db: Db | null = admin,
  options: RecordOptions = {},
): Promise<string | null> {
  if (!db) return null;

  const { retryDelayMs = RETRY_DELAY_MS, report = (text: string) => console.error(`[persist] ${text}`) } = options;

  try {
    const matchId = randomUUID();
    const base = {
      id: matchId,
      room_id: match.roomId,
      mode: match.mode,
      config: match.config,
      winner_profile_id: match.winnerProfileId,
    };

    let error = await insertWithRetry(db, replay ? { ...base, replay } : base, retryDelayMs);
    if (error && replay) {
      // Last resort: the game itself must still be on record, replay or not.
      const replayError = error;
      error = await insertMatch(db, base);
      if (!error) reportReplayLost(match, replayError, report);
    }

    if (error) {
      report(`could not write match ${match.roomId}: ${error.message}`);
      return null;
    }

    const { error: playersError } = await db.from('match_players').insert(
      match.players.map((player) => ({
        match_id: matchId,
        profile_id: player.profileId,
        display_name: player.displayName,
        is_guest: player.isGuest,
        score: player.score,
        placement: player.placement,
        elo_before: player.eloBefore,
        elo_after: player.eloAfter,
        elo_delta: player.eloDelta,
        outcome: player.outcome,
      })),
    );

    if (playersError) {
      console.error('[persist] could not write match players:', playersError.message);
    }

    // Guests have no row to update, and casual matches leave ratings alone.
    const rated = match.players.filter((p) => !p.isGuest && p.profileId);
    if (match.mode !== 'ranked' || rated.length === 0) return matchId;

    await Promise.all(
      rated.map((player) =>
        db.rpc('apply_match_result', {
          p_profile_id: player.profileId,
          p_elo_after: player.eloAfter,
          p_outcome: player.outcome,
        }),
      ),
    );
    return matchId;
  } catch (error) {
    console.error('[persist] unexpected failure:', (error as Error).message);
    return null;
  }
}

/**
 * One insert into `matches`: null once the row is in, else why it is not. A
 * unique violation counts as in — the id is ours, so the row is from an earlier
 * try of this same insert whose answer never reached us.
 */
async function insertMatch(db: Db, values: Record<string, unknown>): Promise<DbError | null> {
  try {
    const { error } = await db.from('matches').insert(values);
    return !error || error.code === '23505' ? null : error;
  } catch (thrown) {
    // A client that throws instead of answering is just another failed try.
    return { message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
}

/** An insert, and one more after a short wait if it failed — unless the database refused the replay itself, which waiting cannot cure. */
async function insertWithRetry(db: Db, values: Record<string, unknown>, delayMs: number): Promise<DbError | null> {
  let error = await insertMatch(db, values);
  if (error && !isReplayRefusal(error)) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    error = await insertMatch(db, values);
  }
  return error;
}

/** 42703 / PGRST204: there is no replay column, so migration 0006 has not been applied. */
function isMissingColumn(error: DbError): boolean {
  return error.code === '42703' || error.code === 'PGRST204';
}

/** The database will never take this replay: no column for it, or (23514) it is over the size check. */
function isReplayRefusal(error: DbError): boolean {
  return isMissingColumn(error) || error.code === '23514';
}

let warnedMissingColumn = false;

/** A match went in without its replay. A missing column would say so after every game, so that one only says it once. */
function reportReplayLost(match: FinishedMatch, error: DbError, report: (text: string) => void): void {
  if (isMissingColumn(error)) {
    if (warnedMissingColumn) return;
    warnedMissingColumn = true;
    report(
      `matches are being saved WITHOUT their replay: the database has no replay column (${error.message}). ` +
        'Run supabase/migrations/0006_match_replays.sql; until then no game can be reviewed from the game log.',
    );
    return;
  }
  report(
    `match ${match.roomId} was saved WITHOUT its replay, which is lost (${error.message}); ` +
      'its game log entry will say "No replay saved".',
  );
}
