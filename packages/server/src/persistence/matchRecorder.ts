import type { FinishedMatch } from '../match/matchManager.js';
import { admin } from '../supabase.js';

/**
 * Writes a finished match to Supabase and applies rating changes.
 *
 * Persistence is best-effort by design: if Supabase is down or unconfigured the
 * match still finished correctly in memory and players already saw their
 * result. A failed write is logged, never thrown — losing a history row must
 * not take the game server down mid-demo.
 *
 * Returns the saved match's id, or null when nothing was written.
 */
export async function recordMatch(match: FinishedMatch): Promise<string | null> {
  const db = admin;
  if (!db) return null;

  try {
    const { data: row, error: matchError } = await db
      .from('matches')
      .insert({
        room_id: match.roomId,
        mode: match.mode,
        config: match.config,
        winner_profile_id: match.winnerProfileId,
      })
      .select('id')
      .single();

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
