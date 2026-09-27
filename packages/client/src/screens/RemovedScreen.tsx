import { REMOVAL_REASON_LABELS, type RemovalNotice } from '@fmm/shared';

interface Props {
  notice: RemovalNotice;
  /** Back to the lobby, or — after a ban — a fresh start at sign-in. */
  onContinue: () => void;
}

/** Who removed you, from where, and why. */
function describe(notice: RemovalNotice): { headline: string; detail: string } {
  // "ABCD “Friday night”", or null when they were not in a room.
  const room = notice.roomId
    ? `${notice.roomId}${notice.roomName ? ` “${notice.roomName}”` : ''}`
    : null;
  const who = notice.by === 'host' ? `the host${notice.byName ? ` (${notice.byName})` : ''}` : 'an admin';

  switch (notice.kind) {
    case 'banned':
      return {
        headline: 'You were removed from the server',
        detail: 'An admin banned you. You can log in again to keep playing.',
      };
    case 'room-closed':
      return {
        headline: 'Game ended by an admin',
        detail: room ? `Room ${room} was closed.` : 'Your room was closed.',
      };
    default:
      return {
        headline: 'You were kicked',
        detail:
          (room ? `You were removed from room ${room} by ${who}.` : `You were kicked by ${who}.`) +
          (notice.roomBan ? ' You can’t rejoin that room.' : ''),
      };
  }
}

/**
 * Shown instead of the lobby or the game after a kick, a ban, or an admin
 * ending the room. The reasons are whatever the host or admin ticked and typed.
 */
export function RemovedScreen({ notice, onContinue }: Props) {
  const { headline, detail } = describe(notice);
  const banned = notice.kind === 'banned';

  return (
    <div className="center-screen">
      <div className={`card removed-card ${banned ? 'banned' : ''}`}>
        <h2>{headline}</h2>
        <p className="muted">{detail}</p>

        {notice.note.reasons.length > 0 && (
          <ul className="reason-tags">
            {notice.note.reasons.map((reason) => (
              <li key={reason} className="tag">
                {REMOVAL_REASON_LABELS[reason]}
              </li>
            ))}
          </ul>
        )}
        {notice.note.remark && <blockquote className="remark">{notice.note.remark}</blockquote>}

        <button className="wide" onClick={onContinue}>
          {banned ? 'Log in again' : 'Back to games'}
        </button>
      </div>
    </div>
  );
}
