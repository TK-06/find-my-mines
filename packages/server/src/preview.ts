import { parseRoomCode, type RoomSummary } from '@fmm/shared';
import { settleWithin } from './safety.js';

/**
 * Link previews.
 *
 * When someone pastes a findmymines.app link into LINE, Discord, WhatsApp or X,
 * the app fetches the page and reads its <meta> tags to draw a card. The client
 * is a single-page app that serves the same index.html on every path, so
 * without help every link would unfurl as the site's default card. Here the
 * server picks the text for two kinds of link — /join/CODE and /u/NAME — and
 * swaps it into the built index.html before sending it.
 *
 * Everything here is pure except the profile lookup, which is passed in. Names
 * come from people (room names, usernames), so every value is cleaned and
 * HTML-escaped on its way into the page.
 */

/** The text of a card: what changes from link to link. */
export interface PreviewText {
  title: string;
  description: string;
}

/** A card plus the canonical path of its link, e.g. /join/K7QX. */
export interface PreviewMeta extends PreviewText {
  path: string;
}

/** What a profile card says about a player, read from the database. */
export interface ProfileSummary {
  username: string;
  elo: number;
  gamesPlayed: number;
}

/** Where a link's information comes from. Both are answered from what the server already knows. */
export interface PreviewLookups {
  /** The room with this code, or undefined when it is gone. */
  room: (code: string) => RoomSummary | undefined;
  /** The account with exactly this username, or null. Never rejects. */
  profile: (name: string) => Promise<ProfileSummary | null>;
}

const SITE = 'Find My Mines';

// ── which link is it ────────────────────────────────────────────────────────

/** What a path points at: a room's share link or a player's public profile. */
export type LinkKind =
  | { kind: 'room'; code: string }
  | { kind: 'profile'; name: string };

/**
 * Which kind of link a URL path is, or null for every other path. The same two
 * rules the client's router applies (joinCodeFromPath and playerNameFromPath in
 * client/src/router.tsx), so a link gets a card exactly when the page it opens
 * is a room or a profile: a room code is 4 letters or digits, a username is 1
 * to 20 characters once decoded, and a broken %-escape names nobody.
 */
export function linkKind(pathname: string): LinkKind | null {
  const room = /^\/join\/([^/]+)\/*$/.exec(pathname);
  if (room) {
    const code = parseRoomCode(room[1]);
    return code ? { kind: 'room', code } : null;
  }

  const profile = /^\/u\/([^/]+)\/*$/.exec(pathname);
  if (profile) {
    try {
      const name = decodeURIComponent(profile[1]!).trim();
      return name.length >= 1 && name.length <= 20 ? { kind: 'profile', name } : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ── the cards ───────────────────────────────────────────────────────────────

/** "1 mine", "11 mines". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** How far along a room is, as a phrase. */
const STATUS_TEXT: Record<RoomSummary['status'], string> = {
  waiting: 'waiting to start',
  playing: 'match in progress',
  ended: 'match finished',
};

/**
 * The card for a room's share link: its name, and what kind of game it is.
 *
 * A room that is gone, and a private one, both get the same generic invitation
 * with no name and no details. A private room's code is the only key to it, so
 * the card must not say more than the code already does — and since the two
 * look alike, the card cannot be used to tell whether a code exists.
 */
export function roomPreview(room: RoomSummary | undefined): PreviewText {
  if (!room || room.config.private === true) {
    return {
      title: `You're invited to a game of ${SITE}`,
      description:
        'Real-time multiplayer Minesweeper, where finding the mines scores points. Open the link to join the game.',
    };
  }

  const { rows, cols, mineCount, maxPlayers, mode, joinByRequest } = room.config;
  // A name made only of control characters is no name at all.
  const name = cleanPreviewText(room.name) || 'Untitled room';
  // The host is "—" when nobody holds the seat; then the card just says "A room".
  const hostName = cleanPreviewText(room.hostNickname);
  const host = hostName && hostName !== '—' ? hostName : '';
  const players =
    maxPlayers === null
      ? plural(room.playerCount, 'player', 'players')
      : `${room.playerCount} of ${maxPlayers} players`;

  const parts = [
    host ? `${host}'s room` : 'A room',
    mode,
    `${rows}×${cols} board, ${plural(mineCount, 'mine', 'mines')}`,
    players,
    STATUS_TEXT[room.status],
  ];
  if (joinByRequest === true) parts.push('ask to join');

  return {
    title: `Join "${name}" · ${SITE}`,
    description: parts.join(' · '),
  };
}

/**
 * The card for a player's public profile, or null when there is no such player
 * (or the lookup failed) — the caller then sends the site's default card. The
 * name on the card is the one the database returned, never one read off the URL.
 *
 * `gamesPlayed` counts rated games only (see carryRatings in index.ts), which
 * is what the profile's own page calls "Ranked games".
 */
export function profilePreview(profile: ProfileSummary | null): PreviewText | null {
  if (!profile) return null;
  const played = profile.gamesPlayed;
  const games =
    played > 0
      ? `${played.toLocaleString('en-US')} ranked ${played === 1 ? 'game' : 'games'}`
      : 'no ranked games yet';
  return {
    title: `${profile.username} · ${SITE}`,
    description: `${profile.elo.toLocaleString('en-US')} Elo · ${games}. Challenge them on ${SITE}.`,
  };
}

/**
 * The card for a path, or null when the page should go out as built — every
 * other path, a profile that does not exist, and a profile lookup that failed.
 * A room is looked up in memory; a profile is awaited.
 */
export async function previewFor(
  pathname: string,
  lookups: PreviewLookups,
): Promise<PreviewMeta | null> {
  const link = linkKind(pathname);
  if (!link) return null;

  if (link.kind === 'room') {
    return { ...roomPreview(lookups.room(link.code)), path: `/join/${link.code}` };
  }

  const profile = await lookups.profile(link.name);
  const text = profilePreview(profile);
  if (!profile || !text) return null;
  return { ...text, path: `/u/${encodeURIComponent(profile.username)}` };
}

// ── writing the page ────────────────────────────────────────────────────────

// Characters that break or disguise text: control codes and line separators
// (which become a space) and the bidirectional overrides (which just go — a
// room name could otherwise make its own title read backwards).
const BREAKS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
const BIDI_CONTROLS = new RegExp('[\\u202a-\\u202e\\u2066-\\u2069]', 'g');

/** A person's text as one tidy line: no control characters, spaces collapsed, trimmed. */
export function cleanPreviewText(text: string): string {
  return text.replace(BIDI_CONTROLS, '').replace(BREAKS, ' ').replace(/\s+/g, ' ').trim();
}

/** Text safe inside an HTML attribute or element: & < > " ' become entities. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** What the page's tags should say: cleaned, then escaped. */
function safe(text: string): string {
  return escapeHtml(cleanPreviewText(text));
}

/**
 * Sets the content of the <meta> tag with this name or property. The tag is
 * found by its attribute order, `name`/`property` first and then `content`, as
 * index.html writes them; a tag that is not there is left alone. The new value
 * goes in through a function so `$` in a name is never read as a pattern.
 */
function setMeta(html: string, attribute: 'name' | 'property', key: string, value: string): string {
  const tag = new RegExp(`(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*(")`);
  return html.replace(tag, (_whole, open: string, close: string) => `${open}${value}${close}`);
}

/**
 * The built index.html with a link's own title, description and url swapped in:
 * the <title>, the description, and the Open Graph and Twitter tags that
 * carry them. Everything else — the image, the theme colours — stays as built.
 * The url is `publicUrl` plus the link's canonical path.
 */
export function renderPreview(template: string, meta: PreviewMeta, publicUrl: string): string {
  const title = safe(meta.title);
  const description = safe(meta.description);
  const url = safe(`${publicUrl}${meta.path}`);

  let html = template.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', description);
  return html;
}

// ── looking a profile up without being a burden ─────────────────────────────

/** How long an answer is remembered. */
export const PROFILE_CACHE_MS = 60_000;

/** How many answers are remembered; past this the oldest is forgotten. */
export const PROFILE_CACHE_MAX = 500;

/** How long a lookup may take before the link gets the default card. */
export const PROFILE_LOOKUP_TIMEOUT_MS = 1500;

/** How long a "too slow" answer is remembered — short, so a recovered database is noticed soon. */
export const PROFILE_SLOW_MS = 10_000;

/** What a timed-out wait resolves to, so it cannot be mistaken for "no such player". */
const TOO_SLOW = Symbol('too slow');

interface CachedProfile {
  value: ProfileSummary | null;
  expiresAt: number;
}

/**
 * Profile lookups for link previews, made safe to point at a database.
 *
 * Chat apps and crawlers fetch a link the moment it is pasted, often several
 * times, and anyone can ask for any name. So an answer — including "no such
 * player" — is remembered for a minute, at most 500 of them are kept (the
 * oldest goes first), and requests for the same name already in flight share
 * one lookup. A lookup that takes longer than 1.5 s gives the page its default
 * card instead of holding it up, and that is remembered briefly too, so a slow
 * database costs one wait, not one per visitor. If the slow answer does arrive,
 * it replaces the placeholder. A failing lookup is the same as no player.
 *
 * The clock is a parameter, for the tests.
 */
export class ProfileLookup {
  private readonly cache = new Map<string, CachedProfile>();
  private readonly inFlight = new Map<string, Promise<ProfileSummary | null>>();

  constructor(
    private readonly fetchProfile: (name: string) => Promise<ProfileSummary | null>,
    private readonly timeoutMs = PROFILE_LOOKUP_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = PROFILE_CACHE_MAX,
  ) {}

  /** The profile for this exact username, or null. Never rejects. */
  async get(name: string): Promise<ProfileSummary | null> {
    const cached = this.cache.get(name);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    let pending = this.inFlight.get(name);
    if (!pending) {
      const started = Promise.resolve()
        .then(() => this.fetchProfile(name))
        .catch((): null => null);
      pending = started;
      this.inFlight.set(name, started);
      void started.then((value) => {
        if (this.inFlight.get(name) === started) this.inFlight.delete(name);
        this.remember(name, value, PROFILE_CACHE_MS);
      });
    }

    const answer = await settleWithin<ProfileSummary | null | typeof TOO_SLOW>(
      pending,
      this.timeoutMs,
      TOO_SLOW,
    );
    if (answer !== TOO_SLOW) return answer;

    // Stop waiting on it, remember that it was slow, and let the next lookup
    // after a short while start fresh. The late answer, if one comes, still
    // lands in the cache above.
    if (this.inFlight.get(name) === pending) this.inFlight.delete(name);
    this.remember(name, null, PROFILE_SLOW_MS);
    return null;
  }

  /** Answers currently remembered. */
  get size(): number {
    return this.cache.size;
  }

  private remember(name: string, value: ProfileSummary | null, ttlMs: number): void {
    // Deleting first moves the name to the back of the map, so the front is
    // always the answer that was stored longest ago.
    this.cache.delete(name);
    this.cache.set(name, { value, expiresAt: this.now() + ttlMs });
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
