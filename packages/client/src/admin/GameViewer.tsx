import type { AdminRoomView } from '@fmm/shared';
import { Board } from '../components/Board.js';
import { Leaderboard } from '../components/Leaderboard.js';

interface Props {
  view: AdminRoomView;
  onStop: () => void;
  onToggleMines: (show: boolean) => void;
  onEndGame: (roomId: string, roomName: string) => void;
}

/**
 * The server console's live view of one room: the same board, timer and
 * leaderboard the players see, plus the mine toggle.
 */
export function GameViewer({ view, onStop, onToggleMines, onEndGame }: Props) {
  const { state, mines } = view;
  // Whether mines are shown is the server's truth, not local state.
  const showing = mines !== null;

  return (
    <div className="card viewer">
      <div className="viewer-head">
        <div>
          <div className="room-title">
            <span className="room-code">{state.roomId}</span>
            <strong>{state.roomName}</strong>
            <span className={`tag status-${state.status}`}>{state.status}</span>
            <span className={`tag mode-${state.config.mode}`}>{state.config.mode}</span>
          </div>
          <div className="muted room-meta">
            {state.rows}×{state.cols} · {state.bombCount} mines · {state.players.length}/
            {state.config.maxPlayers ?? '∞'} players · {state.spectatorCount} watching
          </div>
        </div>
        <div className="room-actions">
          <MineToggle showing={showing} onToggle={() => onToggleMines(!showing)} />
          <button className="danger small" onClick={() => onEndGame(state.roomId, state.roomName)}>
            End game
          </button>
          <button className="ghost small" onClick={onStop}>
            Stop watching
          </button>
        </div>
      </div>

      <Leaderboard state={state} myId={null} />

      {state.status === 'waiting' ? (
        <p className="muted" style={{ textAlign: 'center' }}>
          Waiting for the host to start — the board appears when the match begins.
        </p>
      ) : (
        <Board state={state} myTurn={false} onReveal={() => undefined} mines={mines} />
      )}
    </div>
  );
}

/** A mine icon, struck through while the mines are hidden. */
function MineToggle({ showing, onToggle }: { showing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`mine-toggle ${showing ? 'on' : 'off'}`}
      aria-pressed={showing}
      aria-label={showing ? 'Hide mines' : 'Show mines'}
      title={showing ? 'Hide mines' : 'Show mines'}
      onClick={onToggle}
    >
      <span className="mine-icon" aria-hidden>
        💣
      </span>
    </button>
  );
}
