import {
  STARTING_ELO,
  isGuestId,
  rateMatch,
  type ForfeitNotice,
  type PlayerPublic,
  type PublicMatchState,
} from '@fmm/shared';

/**
 * A guest remembered by this browser for 30 days, with an unofficial Elo.
 *
 * Guests have no account, so the server rates them as a fixed 800 and throws
 * their own change away — and it must go on doing that: nothing a client says
 * about its rating is ever trusted. This cookie is only for the guest's own
 * benefit. It holds a name and a rating the browser worked out for itself, and
 * the page always calls that rating unofficial.
 *
 * It also holds a random id. That one is sent: with the name when the guest
 * joins, so a report sent by or about this guest can say "the same browser as
 * last time". The server keeps it in memory, and in a report when there is one.
 *
 * Everything in this file is pure, bar the three small functions at the end
 * that touch `document.cookie`.
 */

export const GUEST_COOKIE = 'fmm_guest';

/** Thirty days, counted from the last visit: the cookie is written again each time. */
export const GUEST_KEEP_SECONDS = 30 * 24 * 60 * 60;
export const GUEST_KEEP_MS = GUEST_KEEP_SECONDS * 1000;

/** The longest nickname the name screen and the server allow. */
export const GUEST_NAME_MAX = 20;

export const GUEST_RATING_MIN = 100;
export const GUEST_RATING_MAX = 3000;
/** A sanity ceiling for the counters, not a game rule: a hand-edited cookie cannot show 1e300 wins. */
const COUNT_MAX = 1_000_000;

export interface GuestProfile {
  v: 1;
  /** Random, made by this browser (see newGuestId). Only ever used to label reports. */
  id: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** When it was last written (ms since epoch), so a stale copy can be told from a fresh one. */
  updated: number;
}

/**
 * The same rule as the name screen and the server: something left after
 * trimming, at most 20 characters. Stored names are already trimmed.
 */
export function isGuestName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= GUEST_NAME_MAX;
}

/** 16 random bytes in hex: what isGuestId accepts. */
export function newGuestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= COUNT_MAX;
}

/**
 * A cookie's value read back. Anything that is not exactly what this version
 * wrote — bad encoding, bad JSON, a wrong version, out-of-range numbers, a
 * name the game would refuse, a copy older than 30 days — is no cookie at all.
 */
export function parseGuestCookie(
  value: string | null | undefined,
  now = Date.now(),
  makeId: () => string = newGuestId,
): GuestProfile | null {
  if (!value) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const { v, id, name, rating, games, wins, losses, draws, updated } = data;
  if (v !== 1 || !isGuestName(name)) return null;
  if (
    typeof rating !== 'number' ||
    !Number.isInteger(rating) ||
    rating < GUEST_RATING_MIN ||
    rating > GUEST_RATING_MAX
  ) {
    return null;
  }
  if (!isCount(games) || !isCount(wins) || !isCount(losses) || !isCount(draws)) return null;
  if (typeof updated !== 'number' || !Number.isFinite(updated) || updated <= 0) return null;
  if (now - updated > GUEST_KEEP_MS) return null;

  // Cookies written before the id existed get one now; it is saved with the next write.
  return { v: 1, id: isGuestId(id) ? id : makeId(), name, rating, games, wins, losses, draws, updated };
}

/** The whole `name=value; attributes` string to assign to `document.cookie`. */
export function serializeGuestCookie(profile: GuestProfile, secure: boolean): string {
  const body = encodeURIComponent(
    JSON.stringify({
      v: 1,
      id: profile.id,
      name: profile.name,
      rating: profile.rating,
      games: profile.games,
      wins: profile.wins,
      losses: profile.losses,
      draws: profile.draws,
      updated: profile.updated,
    }),
  );
  return `${GUEST_COOKIE}=${body}; Max-Age=${GUEST_KEEP_SECONDS}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** What expires the cookie at once. */
export function clearGuestCookieString(secure: boolean): string {
  return `${GUEST_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** One cookie's raw value out of a `document.cookie` string, or null. */
export function readCookieValue(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** A first-time guest: the starting rating, an empty record and a fresh id. */
export function newGuestProfile(name: string, now: number, id: string = newGuestId()): GuestProfile {
  return { v: 1, id, name, rating: STARTING_ELO, games: 0, wins: 0, losses: 0, draws: 0, updated: now };
}

/**
 * Joining, or renaming, as a guest. The same person on this browser keeps
 * their record under a new name; only "Not you?" starts over.
 */
export function withGuestName(
  profile: GuestProfile | null,
  name: string,
  now: number,
  idIfNew: string = newGuestId(),
): GuestProfile {
  return profile ? { ...profile, name, updated: now } : newGuestProfile(name, now, idIfNew);
}

/** The same record, seen again today: another 30 days. */
export function refreshed(profile: GuestProfile, now: number): GuestProfile {
  return { ...profile, updated: now };
}

/** A finished ranked match added to the record. The rating stays inside the range a cookie may hold. */
export function withResult(
  profile: GuestProfile,
  change: Pick<UnofficialChange, 'delta' | 'outcome'>,
  now: number,
): GuestProfile {
  const rating = Math.min(GUEST_RATING_MAX, Math.max(GUEST_RATING_MIN, profile.rating + change.delta));
  return {
    ...profile,
    rating,
    games: Math.min(COUNT_MAX, profile.games + 1),
    wins: Math.min(COUNT_MAX, profile.wins + (change.outcome === 'win' ? 1 : 0)),
    losses: Math.min(COUNT_MAX, profile.losses + (change.outcome === 'loss' ? 1 : 0)),
    draws: Math.min(COUNT_MAX, profile.draws + (change.outcome === 'draw' ? 1 : 0)),
    updated: now,
  };
}

// ── the guest's own, unofficial rating change ────────────────────────────────

/** A seat as far as rating is concerned: the fields of `PlayerPublic` the maths needs. */
export type RatedSeat = Pick<PlayerPublic, 'id' | 'score' | 'elo' | 'eloDelta' | 'isGuest' | 'bot'>;

/**
 * What the table saw of a seat going into the match: an account's rating
 * before this match moved it (the server has already applied the change to
 * `elo` by the time a match has ended), and 800 for a guest or a computer.
 */
export function publicRatingBefore(seat: Pick<RatedSeat, 'elo' | 'eloDelta' | 'isGuest' | 'bot'>): number {
  if (seat.isGuest || seat.bot) return STARTING_ELO;
  return seat.elo - (seat.eloDelta ?? 0);
}

export interface UnofficialChange {
  delta: number;
  before: number;
  after: number;
  outcome: 'win' | 'loss' | 'draw';
}

/**
 * The guest's own Elo change for a finished match, worked out with the same
 * `rateMatch` the server uses: the guest enters as a rated player (their
 * stored rating and games), everyone else at the rating they walked in with.
 * A casual match, or one the guest was not in, changes nothing (null).
 */
export function unofficialRatingChange(input: {
  ranked: boolean;
  myId: string;
  seats: readonly RatedSeat[];
  profile: Pick<GuestProfile, 'rating' | 'games'>;
}): UnofficialChange | null {
  const { ranked, myId, seats, profile } = input;
  if (!ranked) return null;
  const me = seats.find((seat) => seat.id === myId);
  if (!me || seats.length < 2) return null;

  const results = rateMatch(
    seats.map((seat) =>
      seat.id === myId
        ? { id: seat.id, rating: profile.rating, gamesPlayed: profile.games, score: seat.score, isGuest: false }
        : { id: seat.id, rating: publicRatingBefore(seat), gamesPlayed: 0, score: seat.score, isGuest: true },
    ),
    true,
  );
  const mine = results.find((result) => result.id === myId);
  if (!mine) return null;
  return { delta: mine.delta, before: mine.ratingBefore, after: mine.ratingAfter, outcome: mine.outcome };
}

/**
 * The seats of a forfeited match, scored the way the server does it: the
 * winner 1, everyone else 0. The leaver is no longer in the room's seats, so
 * their rating comes from `snapshot`, the last state seen while it was played.
 */
export function forfeitSeats(notice: ForfeitNotice, snapshot: PublicMatchState): RatedSeat[] {
  return notice.players.map((player) => {
    const known = snapshot.players.find((p) => p.id === player.id);
    return {
      id: player.id,
      score: player.id === notice.winnerId ? 1 : 0,
      elo: known?.elo ?? STARTING_ELO,
      eloDelta: undefined,
      isGuest: known?.isGuest ?? true,
      bot: known?.bot,
    };
  });
}

// ── once per match ───────────────────────────────────────────────────────────

/**
 * Whether the state just received is the end of a match this tab watched from
 * a seat, so its result should be counted — and so only once. `snapshot` is
 * the last state seen while the match was *playing*, kept by the caller and
 * dropped as soon as a result is counted. A reconnect (no snapshot), a repeat
 * of the ended state, a re-render and a spectator all come out false.
 */
export function endedResultApplies(
  snapshot: PublicMatchState | null,
  next: PublicMatchState,
  myId: string | null,
): boolean {
  if (!snapshot || myId === null) return false;
  return (
    snapshot.status === 'playing' &&
    next.status === 'ended' &&
    snapshot.roomId === next.roomId &&
    snapshot.players.some((p) => p.id === myId) &&
    next.players.some((p) => p.id === myId)
  );
}

/**
 * Whether a forfeit notice is a win this tab saw from a seat. Only the player
 * who stayed is told; the one who left is not here to count it.
 */
export function forfeitResultApplies(
  snapshot: PublicMatchState | null,
  notice: ForfeitNotice,
  myId: string | null,
): boolean {
  if (!snapshot || myId === null) return false;
  return (
    snapshot.status === 'playing' &&
    snapshot.roomId === notice.roomId &&
    notice.winnerId === myId &&
    snapshot.players.some((p) => p.id === myId)
  );
}

// ── the browser's cookie jar ─────────────────────────────────────────────────
// Cookies can be blocked (privacy settings, a sandboxed frame). The game then
// works as it always did: the guest simply isn't remembered.

function isSecurePage(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}

export function loadGuestProfile(now = Date.now()): GuestProfile | null {
  try {
    return parseGuestCookie(readCookieValue(document.cookie, GUEST_COOKIE), now);
  } catch {
    return null;
  }
}

export function saveGuestProfile(profile: GuestProfile): void {
  try {
    document.cookie = serializeGuestCookie(profile, isSecurePage());
  } catch {
    // Blocked: this tab still has the record in memory until it closes.
  }
}

export function clearGuestProfile(): void {
  try {
    document.cookie = clearGuestCookieString(isSecurePage());
  } catch {
    // Nothing was stored that could be removed.
  }
}
