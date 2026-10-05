import { isMatchId, parseReplay, type Replay } from '@fmm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin } from '../supabase.js';

type Db = Pick<SupabaseClient, 'from'>;

let warnedMissingColumn = false;

/**
 * The replay saved with a match, read with the service role so the coach's
 * facts come from the server's own copy and never from the page. Null when
 * Supabase is off, there is no such match or it has no replay, the replay does
 * not hold together, or anything goes wrong — the coach then says it has no
 * facts for that game.
 */
export async function loadReplay(matchId: string, db: Db | null = admin): Promise<Replay | null> {
  if (!db || !isMatchId(matchId)) return null;

  try {
    const { data, error } = await db.from('matches').select('replay').eq('id', matchId).maybeSingle();
    if (error) {
      // 42703 / PGRST204: the column is not there, so migration 0006 has not run.
      if ((error.code === '42703' || error.code === 'PGRST204') && !warnedMissingColumn) {
        warnedMissingColumn = true;
        console.warn('[coach] no replay column yet — run supabase/migrations/0006_match_replays.sql.');
      } else if (error.code !== '42703' && error.code !== 'PGRST204') {
        console.error('[coach] could not read a replay:', error.message);
      }
      return null;
    }
    return parseReplay((data as { replay?: unknown } | null)?.replay);
  } catch (error) {
    console.error('[coach] could not read a replay:', error);
    return null;
  }
}
