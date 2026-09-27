import type { JoinRequestPublic, ModerationResult } from '@fmm/shared';
import { useState } from 'react';

interface Props {
  requests: JoinRequestPublic[];
  onAnswer: (requesterId: string, accept: boolean) => Promise<ModerationResult>;
}

/**
 * The host's popups: one card per person asking to join, with Accept and
 * Decline. Rendered only for the host; the list comes from the room state, so
 * a new host sees the pending requests the moment they take over.
 */
export function JoinRequestToasts({ requests, onAnswer }: Props) {
  const [busy, setBusy] = useState<Set<string>>(new Set());

  if (requests.length === 0) return null;

  async function answer(id: string, accept: boolean) {
    setBusy((current) => new Set(current).add(id));
    await onAnswer(id, accept);
    setBusy((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="request-toasts" role="status" aria-live="polite">
      {requests.map((request) => (
        <div key={request.id} className="card request-toast">
          <div>
            <div className="request-who">
              <strong>{request.nickname}</strong>
              {request.isGuest && <span className="tag">guest</span>}
            </div>
            <div className="muted">wants to join your room</div>
          </div>
          <div className="room-actions">
            <button
              className="ghost small"
              disabled={busy.has(request.id)}
              onClick={() => void answer(request.id, false)}
            >
              Decline
            </button>
            <button
              className="small"
              disabled={busy.has(request.id)}
              onClick={() => void answer(request.id, true)}
            >
              Accept
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
