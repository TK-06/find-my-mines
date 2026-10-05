import { randomUUID } from 'node:crypto';
import type { Replay } from '@fmm/shared';

/** Most replays kept at once. The least recently used goes first. */
export const REPLAY_KEEP = 200;

/** How long an unused replay stays: two hours. */
export const REPLAY_TTL_MS = 2 * 60 * 60 * 1000;

/** One finished game the server is holding on to for the coach. */
export interface StoredReplay {
  /** The random id the room was told it under. */
  id: string;
  /** The saved match's id, once the database has it. */
  matchId: string | null;
  replay: Replay;
}

interface Entry extends StoredReplay {
  /** When it was last asked for (or made). Only a replay nobody touches expires. */
  usedAt: number;
}

/**
 * The finished games' replays, in memory, so the coach works with no database
 * at all and a game just played costs it no round trip.
 *
 * Bounded two ways: at most `keep` of them (the least recently used is dropped
 * first) and none older than `ttlMs` since last use. A replay is public by then
 * — the match is over, and the room was sent it — but memory is not unlimited.
 * Pure but for the random id: the caller passes the clock in.
 */
export class ReplayStore {
  /** Oldest use first: a Map iterates in insertion order and a use re-inserts. */
  private readonly entries = new Map<string, Entry>();
  private readonly byMatch = new Map<string, string>();

  constructor(
    private readonly keep = REPLAY_KEEP,
    private readonly ttlMs = REPLAY_TTL_MS,
    private readonly makeId: () => string = randomUUID,
  ) {}

  /** Stores a replay and returns the id it is kept under. */
  add(replay: Replay, now: number, matchId: string | null = null): string {
    this.forgetOld(now);
    const id = this.makeId();
    this.entries.set(id, { id, matchId, replay, usedAt: now });
    if (matchId) this.byMatch.set(matchId, id);
    while (this.entries.size > this.keep) this.drop(this.entries.keys().next().value!);
    return id;
  }

  /** The replay under this id, or undefined when it is unknown or has expired. Counts as a use. */
  get(id: string, now: number): StoredReplay | undefined {
    return this.touch(id, now);
  }

  /** The replay of this saved match, if the server still holds it. Counts as a use. */
  getByMatch(matchId: string, now: number): StoredReplay | undefined {
    const id = this.byMatch.get(matchId);
    return id === undefined ? undefined : this.touch(id, now);
  }

  /** Records that the replay was saved as this match. False when the replay is gone. */
  link(id: string, matchId: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.matchId = matchId;
    this.byMatch.set(matchId, id);
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  private touch(id: string, now: number): StoredReplay | undefined {
    this.forgetOld(now);
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    entry.usedAt = now;
    // Back of the line: it is the most recently used now.
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  private forgetOld(now: number): void {
    for (const [id, entry] of this.entries) {
      // Oldest use first, so the first one still fresh ends the walk.
      if (now - entry.usedAt <= this.ttlMs) break;
      this.drop(id);
    }
  }

  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (entry.matchId && this.byMatch.get(entry.matchId) === id) this.byMatch.delete(entry.matchId);
  }
}
