import type { QueueSnapshot, RoomMode } from '@fmm/shared';

interface Props {
  queue: QueueSnapshot | null;
  onJoin: (mode: RoomMode) => void;
  onLeave: () => void;
}

/**
 * Quick match: join a pool and get paired by rating.
 *
 * While waiting, the widening Elo window is shown rather than hidden — a player
 * who can see the search loosening understands why the wait is growing.
 */
export function QueuePanel({ queue, onJoin, onLeave }: Props) {
  if (!queue) {
    return (
      <div className="card queue-card">
        <div className="queue-copy">
          <h3 style={{ margin: 0 }}>Quick match</h3>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Get paired automatically with someone near your rating.
          </p>
        </div>
        <div className="room-actions">
          <button className="ghost" onClick={() => onJoin('casual')}>
            Casual
          </button>
          <button onClick={() => onJoin('ranked')}>Ranked</button>
        </div>
      </div>
    );
  }

  const seconds = Math.floor(queue.waitedMs / 1000);

  return (
    <div className="card queue-card searching">
      <div className="queue-copy">
        <h3 style={{ margin: 0 }}>
          <span className="pulse-dot" /> Searching for a {queue.mode} match…
        </h3>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {seconds}s · {queue.queued} in pool · accepting ±{queue.eloWindow} Elo
        </p>
      </div>
      <button className="ghost" onClick={onLeave}>
        Cancel
      </button>
    </div>
  );
}
