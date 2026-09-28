/** How long a player waits before inviting the same friend again. */
export const INVITE_COOLDOWN_MS = 10_000;

/**
 * Remembers when each player last invited each friend, so one eager player
 * cannot bury a friend's screen in popups.
 *
 * Keyed by account ids, not socket ids: a second tab is the same player and
 * gets no fresh allowance. Pure — the caller passes the clock in.
 */
export class InviteLimit {
  /** When each sender → friend pair last got an invite through. */
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly cooldownMs = INVITE_COOLDOWN_MS) {}

  /**
   * Records an invite from `from` to `to` and returns 0 — or, when the last
   * one went out too recently, records nothing and returns the milliseconds
   * left. A refused attempt does not restart the clock.
   */
  tryInvite(from: string, to: string, now: number): number {
    this.forgetCooled(now);

    const key = JSON.stringify([from, to]);
    const last = this.lastSent.get(key);
    if (last !== undefined) return this.cooldownMs - (now - last);

    this.lastSent.set(key, now);
    return 0;
  }

  /** Pairs still cooling down. */
  get size(): number {
    return this.lastSent.size;
  }

  private forgetCooled(now: number): void {
    for (const [key, at] of this.lastSent) {
      if (now - at >= this.cooldownMs) this.lastSent.delete(key);
    }
  }
}
