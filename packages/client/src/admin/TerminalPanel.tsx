import type { LogLine } from '@fmm/shared';
import { useEffect, useRef, useState } from 'react';

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

/**
 * The raw socket feed: connects, nicknames, room moves, disconnects with
 * Socket.IO's own reason, moderation — and, when ticked, every event a game
 * client sends. The socket programming, visible as it happens.
 */
export function TerminalPanel({ lines }: { lines: LogLine[] }) {
  const [open, setOpen] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  /** Follow new lines unless the reader has scrolled up to look at older ones. */
  const following = useRef(true);

  const visible = showTraffic ? lines : lines.filter((line) => line.kind !== 'traffic');

  useEffect(() => {
    const el = body.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [visible.length, open]);

  return (
    <div className="card terminal-card">
      <div className="lobby-head">
        <h3 style={{ margin: 0 }}>Terminal</h3>
        <div className="terminal-controls">
          {open && (
            <label className="checkbox" style={{ marginTop: 0 }}>
              <input
                type="checkbox"
                checked={showTraffic}
                onChange={(e) => setShowTraffic(e.target.checked)}
              />
              Show game traffic
            </label>
          )}
          <button className="ghost small" onClick={() => setOpen((v) => !v)}>
            {open ? 'Close terminal' : 'Open terminal'}
          </button>
        </div>
      </div>

      {open && (
        <div
          className="terminal"
          ref={body}
          role="log"
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {visible.length === 0 ? (
            <div className="term-line">No activity yet.</div>
          ) : (
            visible.map((line) => (
              <div key={line.id} className={`term-line kind-${line.kind}`}>
                <span className="term-time">{clock(line.at)}</span>
                <span className="term-kind">{line.kind}</span>
                <span className="term-text">{line.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
