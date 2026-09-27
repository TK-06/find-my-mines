/** Who a held seat belongs to, or who is asking for it back. */
export interface SeatOwner {
  profileId: string | null;
  nickname: string;
}

/**
 * Whether a reconnecting tab is the player whose seat was held.
 *
 * The session id only says "same browser tab". A tab can come back as someone
 * else — a guest who signed in, an account signed out in another tab — and
 * must not inherit another player's seat, score and rating. An account is
 * matched by its id (renames included); a guest has only its name.
 */
export function isSamePlayer(held: SeatOwner, returning: SeatOwner): boolean {
  if (held.profileId !== null) return held.profileId === returning.profileId;
  return returning.profileId === null && held.nickname === returning.nickname;
}
