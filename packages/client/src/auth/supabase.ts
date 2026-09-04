import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client.
 *
 * Only the URL and the **anon** key live here. Both are public by design — the
 * anon key is safe to ship, and row-level security is what actually protects
 * the data. The service-role key must never appear in this bundle; Vite inlines
 * anything it can reach, so it is kept out of every VITE_ variable.
 *
 * When the variables are missing the app runs guest-only and still works.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const authEnabled = Boolean(url && anonKey);

export type OAuthProvider = 'google' | 'github';

/**
 * Which social sign-in buttons to show.
 *
 * A provider only works once an OAuth app exists on the provider's side AND it
 * is enabled in the Supabase dashboard. Showing a button before then gives an
 * "Unsupported provider" dead end, so they stay hidden until opted in with
 * VITE_OAUTH_PROVIDERS=google,github.
 */
export const oauthProviders: OAuthProvider[] = String(
  import.meta.env.VITE_OAUTH_PROVIDERS ?? '',
)
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter((name): name is OAuthProvider => name === 'google' || name === 'github');

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/** Current access token, or undefined when playing as a guest. */
export async function currentAccessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}
