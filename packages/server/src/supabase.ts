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
