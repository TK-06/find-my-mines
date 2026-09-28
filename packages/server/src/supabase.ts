import { STARTING_ELO, type Identity } from '@fmm/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase access.
 *
 * Uses the SERVICE ROLE key, which bypasses RLS. It must never reach the
 * browser — only VITE_-prefixed vars are bundled, and this one is not.
 *
 * Everything here is optional: with no credentials the server runs in
 * guest-only mode and the game still works end to end. That keeps the demo
 * alive if Supabase is unreachable, and lets the test suite run without
 * secrets.
 */

const url = process.env.SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const supabaseEnabled = Boolean(url && serviceKey);

export const admin: SupabaseClient | null = supabaseEnabled
  ? createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

/**
 * The account behind a token, when that account is listed in `public.admins`.
 * Returns a label for the console log (email, else id), or null.
 *
 * Only the service role can read `admins` — RLS is on with no policies — so a
 * player can neither see who the admins are nor add themselves.
 */
export async function adminAccountFromToken(
  accessToken: string | undefined,
): Promise<string | null> {
  if (!admin || !accessToken) return null;

  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const { data: row } = await admin
    .from('admins')
    .select('profile_id')
    .eq('profile_id', data.user.id)
    .maybeSingle();

  return row ? (data.user.email ?? data.user.id) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether two accounts are friends: an accepted row in `public.friendships`,
 * whoever asked. Read with the service role, so the answer never depends on
 * what either player's browser says.
 *
 * False when Supabase is off, the table is missing, or anything goes wrong —
 * the invite is refused, which is the safe way to fail.
 */
export async function areFriends(a: string, b: string): Promise<boolean> {
  if (!admin || a === b || !UUID.test(a) || !UUID.test(b)) return false;

  try {
    // Both ids on both sides: with self-friendship ruled out by the table,
    // that matches exactly a→b or b→a.
    const { data, error } = await admin
      .from('friendships')
      .select('requester_id')
      .in('requester_id', [a, b])
      .in('addressee_id', [a, b])
      .eq('status', 'accepted')
      .limit(1);
    if (error) {
      // Most likely migration 0003 has not been applied yet.
      console.error('[friends] could not check a friendship:', error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error('[friends] could not check a friendship:', error);
    return false;
  }
}

/** A guest identity. No account, no persistence, fixed starting rating. */
export function guestIdentity(nickname: string): Identity {
  return {
    profileId: null,
    nickname: nickname.trim().slice(0, 20) || 'Guest',
    elo: STARTING_ELO,
    gamesPlayed: 0,
    isGuest: true,
  };
}

/**
 * Resolves a handshake token to a real identity.
 *
 * The token is verified against Supabase — the client's claims about who it is
 * are never trusted. Any failure degrades to a guest rather than throwing, so a
 * bad or expired token cannot lock someone out of the game.
 */
export async function identityFromToken(
  accessToken: string | undefined,
  fallbackNickname: string,
): Promise<Identity> {
  if (!admin || !accessToken) return guestIdentity(fallbackNickname);

  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data.user) return guestIdentity(fallbackNickname);

  const { data: profile } = await admin
    .from('profiles')
    .select('id, username, elo, games_played')
    .eq('id', data.user.id)
    .single();

  if (!profile) return guestIdentity(fallbackNickname);

  return {
    profileId: profile.id as string,
    nickname: (profile.username as string) ?? fallbackNickname,
    elo: (profile.elo as number) ?? STARTING_ELO,
    gamesPlayed: (profile.games_played as number) ?? 0,
    isGuest: false,
  };
}
