import type { ModerationResult, RoomSummary } from '@fmm/shared';
import { useEffect, useState } from 'react';
import type { RequestResolution } from '../useGame.js';

interface Props {
  room: RoomSummary;
  /** The latest answer from the server, for any room. */
  resolution: RequestResolution | null;
  onRequest: () => Promise<ModerationResult>;
  /** Withdraws a pending request. */
  onWithdraw: () => void;
  onClose: () => void;
}

type Phase = 'confirm' | 'sending' | 'waiting' | 'declined' | 'closed' | 'error';

/**
 * "Request to join this room": ask, then wait for the host's answer.
 *
 * Accepting seats you on the server, and the room screen replaces the lobby —
 * which unmounts this dialog. Closing it while waiting withdraws the request.
 */
export function JoinRequestDialog({ room, resolution, onRequest, onWithdraw, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!resolution || resolution.roomId !== room.id) return;
    if (resolution.outcome === 'declined') {
      setMessage(`${resolution.byName ?? 'The host'} declined your request.`);
      setPhase('declined');
    } else if (resolution.outcome === 'closed') {
      setMessage('The room closed before the host answered.');
      setPhase('closed');
    }
  }, [resolution, room.id]);

  const close = () => {
    if (phase === 'waiting') onWithdraw();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function request() {
    setPhase('sending');
    const result = await onRequest();
    if (result.ok) {
      setPhase('waiting');
    } else {
      setMessage(result.error ?? 'That did not work.');
      setPhase('error');
    }
  }

  const limit = room.config.maxPlayers ?? '∞';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="request-title">
      <div className="card request-dialog">
        <button type="button" className="dialog-close" aria-label="Close" onClick={close}>
          ×
        </button>

        <h2 id="request-title">Request to join this room</h2>
        <div className="room-title">
          <span className="room-code">{room.id}</span>
          <strong>{room.name}</strong>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Host {room.hostNickname} · {room.config.rows}×{room.config.cols} · {room.config.mineCount}{' '}
          mines · {room.playerCount}/{limit} players
        </p>

        {phase === 'waiting' && (
          <p className="request-status">
            <span className="pulse-dot" /> Waiting for {room.hostNickname} to answer…
          </p>
        )}
        {(phase === 'declined' || phase === 'closed' || phase === 'error') && message && (
          <p className="form-error">{message}</p>
        )}
        {(phase === 'confirm' || phase === 'sending') && (
          <p className="muted">The host decides who plays in this room. They’ll see your request right away.</p>
        )}

        <div className="result-actions">
          {phase === 'confirm' || phase === 'sending' ? (
            <>
              <button type="button" className="ghost" onClick={close}>
                Cancel
              </button>
              <button type="button" disabled={phase === 'sending'} onClick={() => void request()}>
                {phase === 'sending' ? 'Sending…' : 'Request'}
              </button>
            </>
          ) : phase === 'waiting' ? (
            <button type="button" className="ghost" onClick={close}>
              Cancel request
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
