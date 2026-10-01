import { useEffect, useState } from 'react';
import { clockDigits, elapsedMs } from '../../data/puzzleStore.js';

/**
 * The game clock. It keeps its own tick, so only these few characters
 * re-render four times a second — never the board's 480 cells.
 */
export function PuzzleClock({ startedAt, endedAt }: { startedAt: number | null; endedAt: number | null }) {
  const running = startedAt !== null && endedAt === null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const seconds = Math.floor(elapsedMs({ startedAt, endedAt }, now) / 1000);
  return (
    <div className="puzzle-stat">
      {/* Padded digits read badly ("zero four two"), so a screen reader gets
          the words instead. Not a live region: a ticking clock would talk
          over the game every second. */}
      <span className="puzzle-digits" aria-hidden="true">
        {clockDigits(seconds)}
      </span>
      <span className="puzzle-stat-label" aria-hidden="true">
        seconds
      </span>
      <span className="puzzle-sr">{`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}</span>
    </div>
  );
}
