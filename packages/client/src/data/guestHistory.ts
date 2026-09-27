/**
 * A guest's own match history, remembered by this browser.
 *
 * Guests have no account, so the database cannot say which rows are theirs.
 * Instead the server tells every seat the id of the match it just saved
 * (`match:recorded`), and a guest's browser keeps those ids here. The game
 * log's "Mine" then loads exactly those matches — no guessing by nickname.
 */

export interface GuestMatch {
  matchId: string;
  /** The name this guest played under, to highlight their seat. */
  nickname: string;
  at: number;
}

const STORAGE_KEY = 'fmm.guestMatches';
const LIMIT = 50;

/** Newest first, no duplicates, at most `limit` entries. */
export function addGuestMatch(list: GuestMatch[], entry: GuestMatch, limit = LIMIT): GuestMatch[] {
  return [entry, ...list.filter((m) => m.matchId !== entry.matchId)].slice(0, limit);
}

function isGuestMatch(value: unknown): value is GuestMatch {
  const v = value as GuestMatch | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.matchId === 'string' &&
    typeof v.nickname === 'string' &&
    typeof v.at === 'number'
  );
}

/** Reads stored history, tolerating anything a user or an old version left there. */
export function parseGuestMatches(raw: string | null): GuestMatch[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isGuestMatch) : [];
  } catch {
    return [];
  }
}

// Storage can be unavailable (private windows, blocked site data); the game
// log then simply has no guest history.

export function loadGuestMatches(): GuestMatch[] {
  try {
    return parseGuestMatches(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function rememberGuestMatch(entry: GuestMatch): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(addGuestMatch(loadGuestMatches(), entry)));
  } catch {
    // Not remembered — the match is still in the public log under "Everyone".
  }
}
