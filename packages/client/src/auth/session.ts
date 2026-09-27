/**
 * Pure session helpers. No Supabase import, so they unit-test without a browser.
 */

/**
 * Whether an auth event means a different person is now using this browser.
 *
 * supabase-js broadcasts SIGNED_IN to every other tab each time a tab loads
 * with a stored session, and TOKEN_REFRESHED about hourly. Treating those as
 * identity changes reloaded every other tab, whose own load broadcast again —
 * an endless reload ping-pong between two tabs. Only a real change counts.
 *
 * `known` is undefined until we learn who is signed in; null means a guest.
 */
export function identityChanged(known: string | null | undefined, next: string | null): boolean {
  if (known === undefined) return false;
  return known !== next;
}

/**
 * A socket.io `auth` callback that reads the access token at handshake time.
 *
 * socket.io calls this when the connection opens (and on every reconnect), so
 * the handshake always carries the current token — no race with the session
 * being restored from storage, and refreshed tokens are picked up for free.
 *
 * `extra` rides along in every handshake, token or not — the tab's session id
 * for reconnecting to a held seat, or the console's ADMIN_TOKEN.
 */
export function tokenAuth(getToken: () => Promise<string | undefined>, extra: object = {}) {
  return (send: (data: object) => void): void => {
    getToken().then(
      (token) => send(token ? { ...extra, accessToken: token } : { ...extra }),
      () => send({ ...extra }),
    );
  };
}
