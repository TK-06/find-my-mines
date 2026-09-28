/** Lines one connection may send inside any window. */
export const CHAT_BURST = 5;

/** The window those lines are counted over. */
export const CHAT_WINDOW_MS = 10_000;

/**
 * Keeps one connection from flooding a room's chat.
 *
 * A sliding window rather than a fixed bucket: a burst of five is fine, a
 * steady stream is fine, but nobody gets a sixth line inside ten seconds,
 * however they time it. Keyed by connection — chat needs no account, so there
 * is nothing better to key it by. Pure — the caller passes the clock in.
 */
export class ChatLimit {
  /** When each connection's recent lines went out, oldest first. */
  private readonly sent = new Map<string, number[]>();

  constructor(
    private readonly burst = CHAT_BURST,
    private readonly windowMs = CHAT_WINDOW_MS,
  ) {}

  /**
   * Records a line from `who` and returns 0 — or, when they have used up the
   * window, records nothing and returns the milliseconds until their oldest
   * line ages out. A refused line does not count against them.
   */
  trySend(who: string, now: number): number {
    this.forgetQuiet(now);

    const recent = this.sent.get(who) ?? [];
    if (recent.length >= this.burst) return this.windowMs - (now - recent[0]!);

    recent.push(now);
    this.sent.set(who, recent);
    return 0;
  }

  /** The connection is gone. */
  forget(who: string): void {
    this.sent.delete(who);
  }

  /** Connections with lines still inside the window. */
  get size(): number {
    return this.sent.size;
  }

  /** Ages out old lines, and drops connections with none left. */
  private forgetQuiet(now: number): void {
    for (const [who, times] of this.sent) {
      const recent = times.filter((at) => now - at < this.windowMs);
      if (recent.length === 0) this.sent.delete(who);
      else if (recent.length !== times.length) this.sent.set(who, recent);
    }
  }
}
