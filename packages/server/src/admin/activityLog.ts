import type { LogKind, LogLine } from '@fmm/shared';

/**
 * The server console's terminal feed.
 *
 * Two ring buffers: game traffic arrives many times faster than connections
 * do, so it gets its own budget and a busy match cannot push the connect and
 * disconnect lines out of view. Memory only — a restart starts a fresh log.
 */
export class ActivityLog {
  private readonly events: LogLine[] = [];
  private readonly traffic: LogLine[] = [];
  private nextId = 1;

  constructor(
    private readonly onLine?: (line: LogLine) => void,
    private readonly capacity = 200,
    private readonly now: () => number = Date.now,
  ) {}

  add(kind: LogKind, text: string): LogLine {
    const line: LogLine = { id: this.nextId++, at: this.now(), kind, text };

    const buffer = kind === 'traffic' ? this.traffic : this.events;
    buffer.push(line);
    if (buffer.length > this.capacity) buffer.shift();

    this.onLine?.(line);
    return line;
  }

  /** Both buffers, in the order the lines happened. Used to backfill a console. */
  recent(): LogLine[] {
    return [...this.events, ...this.traffic].sort((a, b) => a.id - b.id);
  }
}
