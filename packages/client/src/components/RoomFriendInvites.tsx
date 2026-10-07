import type { OnlinePlayer, RoomSummary } from '@fmm/shared';
import { useState } from 'react';
import { groupFriendships } from '../data/friendsModel.js';
import {
  INVITE_ROWS_SHOWN,
  inviteCardView,
  limitRows,
  onlineCount,
  roomInviteRows,
} from '../data/roomInvites.js';
import type { Friendships } from '../data/useFriendships.js';
import { RouteLink, type Route } from '../router.js';
import { Avatar } from './Avatar.js';

export interface RoomFriendInvitesProps {
  /** The signed-in player's friendships, kept by App — the same list as the Friends card. */
  friends: Friendships;
  /** Who is online right now — the lobby feed from useGame. */
  online: OnlinePlayer[];
  /** Open rooms, which the shared friend rows read to say where a friend is. */
  rooms: RoomSummary[];
  /** The room being waited in. */
  roomId: string;
  /** Everyone in it — players and spectators — so a friend already here is not asked over. */
  members: readonly { id: string }[];
  /** Without a connection an invite cannot be sent. */
  connected: boolean;
  /** For the link to the profile page, where friends are added. */
  onNavigate: (next: Route) => void;
}

/**
 * "Invite friends", on a room's waiting screen under the "Waiting for another
 * player…" banner: the next thing to do once the room exists. Your friends,
 * the ones you can invite first, each with an Invite button; the others say
 * where they are (offline, in this room, busy in a match) and have none.
 *
 * It is the Friends card's list (same rows, same dots, same Invite call and
 * the same "Invited" / error note that stands in for the button for a few
 * seconds), boiled down: no player cards, no removing, six rows before
 * "Show all". Whether it shows at all is `showInviteCard`'s call, made by App.
 */
export function RoomFriendInvites({
  friends,
  online,
  rooms,
  roomId,
  members,
  connected,
  onNavigate,
}: RoomFriendInvitesProps) {
  const { friendships, pictures, loaded, error, missingTable, busy, inviteNotes, run } = friends;
  const [expanded, setExpanded] = useState(false);

  const accepted = groupFriendships(friendships).accepted;
  const view = inviteCardView({ loaded, error, missingTable }, accepted.length);
  // The friends table is not there yet (migration 0003): nothing to offer, so say nothing.
  if (view === 'hidden') return null;

  const rows = roomInviteRows(accepted, online, rooms, { roomId, memberIds: members.map((m) => m.id) });
  const shown = limitRows(rows, expanded);
  const onlineNow = onlineCount(rows);

  return (
    <section className="card room-invites" aria-label="Invite friends">
      <div className="room-invites-head">
        <h3>Invite friends</h3>
        {view === 'list' && onlineNow > 0 && <span className="muted">{onlineNow} online</span>}
      </div>

      {view === 'loading' && <p className="muted">Loading friends…</p>}
      {view === 'error' && <p className="form-error">{error}</p>}
      {view === 'empty' && (
        <p className="muted">
          No friends to invite yet. Add some on your{' '}
          <RouteLink to="profile" onNavigate={onNavigate}>
            profile
          </RouteLink>
          .
        </p>
      )}
      {view === 'list' && onlineNow === 0 && (
        <p className="muted">None of your friends are online right now.</p>
      )}

      {view === 'list' && (
        <ul className="list friend-list room-invite-list">
          {shown.map((row) => {
            const note = inviteNotes.get(row.profileId);
            const action = row.action;
            const sending = busy.has(row.profileId);
            return (
              <li
                key={row.profileId}
                className={`friend-row room-invite-row${row.slot === 'offline' ? ' is-offline' : ''}${note?.failed ? ' has-error' : ''}`}
              >
                <Avatar className="friend-avatar" name={row.name} url={pictures.get(row.profileId)} />
                <span className="friend-main">
                  <strong className="friend-name" title={row.name}>
                    {row.name}
                  </strong>
                  <span className="friend-status">
                    <span className={`friend-dot ${row.dot}`} aria-hidden />
                    {row.statusText}
                  </span>
                </span>
                {/* Always present, so screen readers announce "Invited" or the refusal when it replaces the button. */}
                <span className="friend-actions" aria-live="polite">
                  {note ? (
                    <span className={`friend-note${note.failed ? ' failed' : ''}`}>{note.text}</span>
                  ) : (
                    row.slot === 'invite' &&
                    action && (
                      <button
                        type="button"
                        className="ghost small"
                        disabled={!connected || sending}
                        aria-label={`${sending ? 'Inviting' : 'Invite'} ${row.name}`}
                        onClick={() => run(row, action)}
                      >
                        {sending ? 'Inviting…' : action.label}
                      </button>
                    )
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {view === 'list' && rows.length > INVITE_ROWS_SHOWN && (
        <button
          type="button"
          className="ghost small room-invites-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show fewer' : `Show all (${rows.length})`}
        </button>
      )}
    </section>
  );
}
