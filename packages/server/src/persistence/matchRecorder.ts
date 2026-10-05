import type { Replay } from '@fmm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinishedMatch } from '../match/matchManager.js';
import { admin } from '../supabase.js';

/** What the recorder needs from the database client, so a test can hand it a stand-in. */
type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

/**
 * Writes a finished match to Supabase and applies rating changes.
 *
 * Persistence is best-effort by design: if Supabase is down or unconfigured the
 * match still finished correctly in memory and players already saw their
 * result. A failed write is logged, never thrown — losing a history row must
 * not take the game server down mid-demo.
 *
 * The replay (the mines and the order the cells were opened) is saved with the
 * match, in a column migration 0006 adds. Until that has been run the column is
 * not there and the insert fails — so it is asked again without the replay, and
 * recording never breaks over it.
 *
 * Returns the saved match's id, or null when nothing was written.
 */
export async function recordMatch(
  match: FinishedMatch,
  replay: Replay | null = null,
  db: Db | null = admin,
): Promise<string | null> {
  if (!db) return null;

  try {
    const base = {
      room_id: match.roomId,
      mode: match.mode,
      config: match.config,
      winner_profile_id: match.winnerProfileId,
    };

    let { data: row, error: matchError } = await insertMatch(db, replay ? { ...base, replay } : base);
    if (matchError && replay) {
      // No replay column yet (migration 0006 not applied), or the replay was refused: save the match without it.
      warnWithoutReplay(matchError);
      ({ data: row, error: matchError } = await insertMatch(db, base));
    }

    if (matchError || !row) {
      console.error('[persist] could not write match:', matchError?.message);
      return null;
    }
    const matchId = row.id as string;

    const { error: playersError } = await db.from('match_players').insert(
      match.players.map((player) => ({
        match_id: row.id,
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

function insertMatch(db: Db, values: Record<string, unknown>) {
  return db.from('matches').insert(values).select('id').single();
}

let warnedWithoutReplay = false;

/** Once, not per match: a database without migration 0006 would otherwise repeat this after every game. */
function warnWithoutReplay(error: { code?: string; message: string }): void {
  if (warnedWithoutReplay) return;
  warnedWithoutReplay = true;
  console.warn(
    `[persist] could not save the replay (${error.message}); saving matches without it. ` +
      'If the column is missing, run supabase/migrations/0006_match_replays.sql.',
  );
}
