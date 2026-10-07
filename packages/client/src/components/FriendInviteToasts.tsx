import type { FriendInvite } from '@fmm/shared';

export interface FriendInviteToastsProps {
  invites: FriendInvite[];
  onAccept: (invite: FriendInvite) => void;
  onDecline: (invite: FriendInvite) => void;
}

/**
 * A friend's invite to their room, as a popup in the same corner stack as the
 * host's join requests. Accept goes through the normal join path, so an
 * ask-to-join room still asks its host — an invite is not a way round that.
 * Decline closes the popup and lets the friend know. useGame keeps at most a
 * few and lets each expire on its own, which tells nobody.
 */
export function FriendInviteToasts({ invites, onAccept, onDecline }: FriendInviteToastsProps) {
  if (invites.length === 0) return null;

  return (
    <div className="request-toasts" role="status" aria-live="polite">
      {invites.map((invite) => (
        <div key={invite.id} className="card request-toast friend-invite">
          <div className="friend-invite-text">
            <strong>{invite.fromName}</strong> invited you to{' '}
            <strong>{invite.roomName}</strong>{' '}
            <span className="room-code">({invite.roomId})</span>
          </div>
          <div className="room-actions">
            <button
              className="ghost small"
              aria-label={`Decline ${invite.fromName}'s invite`}
              onClick={() => onDecline(invite)}
            >
              Decline
            </button>
            <button
              className="small"
              aria-label={`Accept ${invite.fromName}'s invite to ${invite.roomName}`}
              onClick={() => onAccept(invite)}
            >
              Accept
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
