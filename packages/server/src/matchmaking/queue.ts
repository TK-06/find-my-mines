import {
  eloWindow,
  findPairs,
  type Identity,
  type QueueEntry,
  type QueueSnapshot,
  type RoomMode,
} from '@fmm/shared';
import { contain } from '../safety.js';

const TICK_MS = 1000;

export interface QueueHandlers {
  /** Create a room for a matched pair and seat them. Returns the room id. */
  onPair(a: QueueEntry, b: QueueEntry, mode: RoomMode): string | null;
  /** Queue contents changed — refresh clients and the admin console. */
  onChange(): void;
}

/**
 * The matchmaking pool.
 *
 * A ticking queue rather than pairing on join: a player who arrives alone must
 * still be picked up later as their Elo window widens, and that only happens if
 * something re-checks over time.
 */
export class MatchmakingQueue {
  private readonly entries = new Map<string, QueueEntry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly handlers: QueueHandlers) {}

  /** Adds or replaces a player's queue entry. Re-queueing resets their wait. */
  join(socketId: string, identity: Identity, mode: RoomMode): void {
    this.entries.set(socketId, {
      id: socketId,
      nickname: identity.nickname,
      elo: identity.elo,
      mode,
      joinedAt: Date.now(),
    });
    this.ensureTicking();
    this.handlers.onChange();
  }

  leave(socketId: string): boolean {
    const removed = this.entries.delete(socketId);
    if (removed) {
      this.stopIfEmpty();
      this.handlers.onChange();
    }
    return removed;
  }

  has(socketId: string): boolean {
    return this.entries.has(socketId);
  }

  get size(): number {
    return this.entries.size;
  }

  /** What one waiting player is told about their own wait. */
  statusFor(socketId: string, now = Date.now()): QueueSnapshot | null {
    const entry = this.entries.get(socketId);
    if (!entry) return null;

    const waitedMs = now - entry.joinedAt;
    return {
      mode: entry.mode,
      waitedMs,
      eloWindow: eloWindow(waitedMs),
      queued: [...this.entries.values()].filter((e) => e.mode === entry.mode).length,
    };
  }

  /** Full pool for the server console. */
  snapshot(now = Date.now()): {
    id: string;
    nickname: string;
    elo: number;
    mode: RoomMode;
    waitedMs: number;
    eloWindow: number;
  }[] {
    return [...this.entries.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((entry) => ({
        id: entry.id,
        nickname: entry.nickname,
        elo: entry.elo,
        mode: entry.mode,
        waitedMs: now - entry.joinedAt,
        eloWindow: eloWindow(now - entry.joinedAt),
      }));
  }

  private ensureTicking(): void {
    if (this.timer) return;
    // Runs outside any socket handler, so it contains its own failures.
    this.timer = setInterval(
      contain(
        () => this.tick(),
        (error) => console.error('[matchmaking] tick failed:', error),
      ),
      TICK_MS,
    );
  }

  private stopIfEmpty(): void {
    if (this.entries.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.entries.size < 2) {
      // Still notify so waiting players see their window widening.
      if (this.entries.size > 0) this.handlers.onChange();
      return;
    }

    const pairs = findPairs([...this.entries.values()], Date.now());
    if (pairs.length === 0) {
      this.handlers.onChange();
      return;
    }

    for (const pair of pairs) {
      // Remove first: seating can fail, and a half-removed entry would let the
      // same player be paired twice on the next tick.
      this.entries.delete(pair.a.id);
      this.entries.delete(pair.b.id);
      this.handlers.onPair(pair.a, pair.b, pair.mode);
    }

    this.stopIfEmpty();
    this.handlers.onChange();
  }

  /** Called on shutdown so a stray interval cannot keep the process alive. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.entries.clear();
  }
}
