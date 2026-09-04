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
