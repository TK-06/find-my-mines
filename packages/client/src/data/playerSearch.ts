import type { OnlinePlayer, PresenceStatus } from '@fmm/shared';
import { supabase } from '../auth/supabase.js';
import { isMissingColumn, pictureUrl } from './avatar.js';
import { mostActiveTab, type Friendship } from './friendsModel.js';

/**
 * Finding players by a few letters of their username, for the friends list's
 * type-ahead. Profiles are publicly readable (migration 0001), so this reads
 * them straight from the browser with the public key.
 *
 * The ranking is pure and tested here; the two small functions at the end do
 * the reading.
 */

/** Fewer letters than this matches too many people to be useful. */
export const SEARCH_MIN_CHARS = 2;
/** Rows the dropdown shows. */
export const SEARCH_LIMIT = 8;
/** Typing pauses this long before a search goes out. */
export const SEARCH_DEBOUNCE_MS = 200;
/** Usernames are at most 20 characters, so a longer query matches nobody. */
export const SEARCH_MAX_CHARS = 20;

export interface FoundProfile {
  id: string;
  username: string;
  elo: number;
  avatarUrl: string | null;
}

/** What is already between me and them. */
export type SearchRelation = 'friend' | 'incoming' | 'outgoing' | 'none';

export interface SearchResult extends FoundProfile {
  relation: SearchRelation;
  /** Where they are; 'offline' when none of their tabs is connected. */
  presence: PresenceStatus | 'offline';
  /** The name starts with what was typed — ranked above a match inside the name. */
  prefix: boolean;
}

/** The query as it is searched: trimmed, and no longer than a username can be. */
export function normalizeQuery(query: string): string {
  return query.trim().slice(0, SEARCH_MAX_CHARS);
}

/**
 * LIKE treats `%` and `_` as wildcards and `\` as the escape. Usernames may
 * contain all three — `_` is common — so they are matched literally.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Anywhere in the name, case-insensitively (with ILIKE). */
export function searchPattern(query: string): string {
  return `%${escapeLike(normalizeQuery(query))}%`;
}

const GROUP: Record<SearchRelation, number> = { friend: 0, incoming: 1, outgoing: 1, none: 1 };

/**
 * Found profiles in the order the dropdown shows them: **friends first**, then
 * everyone else. Inside each group, people online now come first, then names
 * that start with what was typed, then the rest by name. You never find
 * yourself.
 */
export function rankResults(
  found: FoundProfile[],
  query: string,
  context: { myId: string; friendships: Friendship[]; online: OnlinePlayer[] },
  limit = SEARCH_LIMIT,
): SearchResult[] {
  const needle = normalizeQuery(query).toLowerCase();
  const relations = new Map<string, SearchRelation>();
  for (const f of context.friendships) {
    relations.set(f.otherId, f.status === 'accepted' ? 'friend' : f.direction);
  }
  const tabs = new Map<string, OnlinePlayer[]>();
  for (const tab of context.online) {
    if (tab.profileId === null) continue;
    tabs.set(tab.profileId, [...(tabs.get(tab.profileId) ?? []), tab]);
  }

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const profile of found) {
    if (profile.id === context.myId || seen.has(profile.id)) continue;
    seen.add(profile.id);
    results.push({
      ...profile,
      relation: relations.get(profile.id) ?? 'none',
      presence: mostActiveTab(tabs.get(profile.id) ?? [])?.status ?? 'offline',
      prefix: profile.username.toLowerCase().startsWith(needle),
    });
  }

  return results
    .sort(
      (a, b) =>
        GROUP[a.relation] - GROUP[b.relation] ||
        Number(a.presence === 'offline') - Number(b.presence === 'offline') ||
        Number(b.prefix) - Number(a.prefix) ||
        a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }),
    )
    .slice(0, limit);
}

/** The few words under a result's name. */
export function presenceText(presence: SearchResult['presence']): string {
  switch (presence) {
    case 'offline':
      return 'Offline';
    case 'playing':
      return 'Playing';
    case 'watching':
      return 'Watching a game';
    case 'queue':
      return 'Looking for a match';
    case 'room':
      return 'In a room';
    default:
      return 'In the menu';
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

type Row = { id: string; username: string; elo: number; avatar_path?: string | null };

export type SearchOutcome = { ok: true; found: FoundProfile[] } | { ok: false; error: string };

async function profilesMatching(pattern: string, onlyIds: string[] | null, limit: number) {
  if (!supabase) return { rows: [] as Row[], error: null };
  const run = (columns: string) => {
    let request = supabase!.from('profiles').select(columns).ilike('username', pattern);
    if (onlyIds) request = request.in('id', onlyIds);
    return request.order('username').limit(limit);
  };
  let { data, error } = await run('id, username, elo, avatar_path');
  // Before migration 0004 there is no picture column; search without it.
  if (isMissingColumn(error)) ({ data, error } = await run('id, username, elo'));
  return { rows: (data ?? []) as unknown as Row[], error };
}

/**
 * Players whose username contains `query`. Friends are searched on their own
 * as well, so one is never pushed out of the list by twenty strangers whose
 * names sort first.
 */
export async function searchProfiles(query: string, friendIds: string[]): Promise<SearchOutcome> {
  const clean = normalizeQuery(query);
  if (!supabase || clean.length < SEARCH_MIN_CHARS) return { ok: true, found: [] };
  const pattern = searchPattern(clean);

  try {
    const [everyone, friends] = await Promise.all([
      profilesMatching(pattern, null, 20),
      friendIds.length > 0 ? profilesMatching(pattern, friendIds.slice(0, 200), SEARCH_LIMIT) : null,
    ]);
    const error = everyone.error ?? friends?.error;
    if (error) {
      console.error('[search] failed:', error.message);
      return { ok: false, error: 'Could not search right now.' };
    }
    const found = [...(friends?.rows ?? []), ...everyone.rows].map((row) => ({
      id: row.id,
      username: row.username,
      elo: row.elo,
      avatarUrl: pictureUrl(row.id, row.avatar_path),
    }));
    return { ok: true, found };
  } catch (error) {
    console.error('[search] failed:', error);
    return { ok: false, error: 'Could not search right now.' };
  }
}
