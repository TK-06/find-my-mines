/**
 * How long the server remembers an invite it relayed. The client's popup goes
 * away a minute after it arrives (INVITE_TTL_MS in the client's friendsModel);
 * the extra seconds here let a Decline pressed at the last moment still land.
 */
export const INVITE_BOOK_TTL_MS = 70_000;

/** The most invites remembered at once. The oldest make room for newer ones. */
export const INVITE_BOOK_MAX = 2_000;

/** An invite the server relayed: who sent it, to whom, and for which room. */
export interface SentInvite {
  /** The id the invited friend's popup carries — random, and only ever sent to them. */
  id: string;
  fromProfileId: string;
  toProfileId: string;
  roomId: string;
  /** When the server stops remembering it, in epoch milliseconds. */
  expiresAt: number;
}

/**
 * The invites sent in the last minute or so, so a Decline can be checked
 * against what really happened instead of against what a client says.
 *
 * A decline is honoured only for an invite that is still remembered, only for
 * the account it was sent to, and only once. Everything else — an id nobody
 * sent, one that ran out, one meant for somebody else — comes back null and
 * changes nothing, so a forged or repeated decline cannot spam the inviter or
 * burn another player's invite.
 *
 * Memory only, bounded, and pure: the caller passes the clock in.
 */
export class InviteBook {
  /** In the order they were sent, which is also the order they expire in. */
  private readonly invites = new Map<string, SentInvite>();

  constructor(
    private readonly ttlMs = INVITE_BOOK_TTL_MS,
    private readonly maxSize = INVITE_BOOK_MAX,
  ) {}

  /** Remembers an invite that was just relayed. */
  remember(invite: Omit<SentInvite, 'expiresAt'>, now: number): void {
    this.forgetExpired(now);
    this.invites.set(invite.id, { ...invite, expiresAt: now + this.ttlMs });
    // Over the cap: let the oldest go first.
    for (const id of this.invites.keys()) {
      if (this.invites.size <= this.maxSize) break;
      this.invites.delete(id);
    }
  }

  /**
   * Takes the invite `id` away and returns it — if it is still remembered and
   * was sent to `byProfileId`. A refused attempt (wrong account, unknown id,
   * expired) returns null and leaves the book as it was.
   */
  decline(id: unknown, byProfileId: string | null | undefined, now: number): SentInvite | null {
    this.forgetExpired(now);
    if (typeof id !== 'string' || !byProfileId) return null;

    const invite = this.invites.get(id);
    if (!invite || invite.expiresAt <= now || invite.toProfileId !== byProfileId) return null;

    this.invites.delete(id);
    return invite;
  }

  /** Invites still remembered. */
  get size(): number {
    return this.invites.size;
  }

  private forgetExpired(now: number): void {
    for (const [id, invite] of this.invites) {
      if (invite.expiresAt > now) break;
      this.invites.delete(id);
    }
  }
}
