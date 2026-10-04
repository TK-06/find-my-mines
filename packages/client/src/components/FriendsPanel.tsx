import type { ModerationResult, OnlinePlayer, RoomSummary } from '@fmm/shared';
import { useMemo, useState } from 'react';
import { acceptFriendRequest, removeFriendship } from '../data/friends.js';
import { MISSING_TABLE_MESSAGE, friendRows, groupFriendships } from '../data/friendsModel.js';
import { useFriendships } from '../data/useFriendships.js';
import { PlayerLink } from '../router.js';
import { Avatar } from './Avatar.js';
import { FriendSearch } from './FriendSearch.js';

export interface FriendsPanelProps {
  /** The signed-in player's profile id. */
  userId: string;
  /** Who is online right now — the lobby feed from useGame. */
  online: OnlinePlayer[];
  /** Open rooms, so a friend's room can offer Join or Watch. */
  rooms: RoomSummary[];
  /** The room this browser is in, or null. Inviting needs one. */
  myRoomId: string | null;
  onJoin: (roomId: string) => void;
  onWatch: (roomId: string) => void;
  onInvite: (profileId: string) => Promise<ModerationResult>;
  /** Opens someone's public profile: every name here is a link to it. */
  onViewProfile: (username: string) => void;
}

/**
 * The friends list on the profile page: requests waiting on you, requests you
 * sent, then your friends and where each one is right now.
 *
 * Friendships live in Supabase (`useFriendships`). Where a friend is comes from
 * the live online list, so a dot changes the moment they start or leave a game
 * — only the friendships themselves are refetched (on mount, after every
 * change, and when the window regains focus).
 */
export function FriendsPanel({
  userId,
  online,
  rooms,
  myRoomId,
  onJoin,
  onWatch,
  onInvite,
  onViewProfile,
}: FriendsPanelProps) {
  const {
    friendships,
    pictures,
    loaded,
    error: loadError,
    missingTable,
    busy,
    notice,
    setNotice,
    inviteNotes,
    change,
    addFromSearch,
    acceptFromSearch,
    run,
  } = useFriendships(userId, { onJoin, onWatch, onInvite });

  const [adding, setAdding] = useState(false);
  /** The friend whose Remove is waiting for a second, deliberate click. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const groups = useMemo(() => groupFriendships(friendships), [friendships]);
  const rows = useMemo(
    () => friendRows(groups.accepted, online, rooms, myRoomId),
    [groups, online, rooms, myRoomId],
  );
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.profileId, row])), [rows]);

  return (
    <section className="card friends-panel">
      <div className="friends-head">
        <h3>Friends · {groups.accepted.length}</h3>
        {!missingTable && (
          <button
            className="ghost small"
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
              setNotice(null);
            }}
          >
            {adding ? 'Close' : '+ Add friend'}
          </button>
        )}
      </div>

      {adding && !missingTable && (
        <FriendSearch
          userId={userId}
          friendships={friendships}
          online={online}
          friendRows={rowsById}
          busy={busy}
          inviteNotes={inviteNotes}
          onAdd={addFromSearch}
          onAccept={acceptFromSearch}
          onFriendAction={run}
          onViewProfile={onViewProfile}
          onClose={() => setAdding(false)}
        />
      )}

      {notice && (
        <p className={notice.failed ? 'form-error' : 'muted'} role="status">
          {notice.text}
        </p>
      )}

      {missingTable ? (
        <p className="muted">{MISSING_TABLE_MESSAGE}</p>
      ) : (
        <>
          {loadError && <p className="form-error">{loadError}</p>}

          {groups.incoming.length > 0 && (
            <ul className="list friend-list">
              {groups.incoming.map((request) => (
                <li key={request.otherId} className="friend-row">
                  <Avatar
                    className="friend-avatar"
                    name={request.otherName}
                    url={pictures.get(request.otherId)}
                  />
                  <span className="friend-main">
                    <strong className="friend-name">
                      <PlayerLink name={request.otherName} onOpen={onViewProfile} />
                    </strong>
                    <span className="friend-status">wants to be friends</span>
                  </span>
                  <span className="friend-actions">
                    <button
                      className="ghost small"
                      disabled={busy.has(request.otherId)}
                      onClick={() =>
                        void change(request.otherId, () => removeFriendship(userId, request.otherId))
                      }
                    >
                      Decline
                    </button>
                    <button
                      className="small"
                      disabled={busy.has(request.otherId)}
                      onClick={() =>
                        void change(
                          request.otherId,
                          () => acceptFriendRequest(userId, request.otherId),
                          `You and ${request.otherName} are friends now.`,
                        )
                      }
                    >
                      Accept
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {groups.outgoing.length > 0 && (
            <ul className="list friend-list">
              {groups.outgoing.map((request) => (
                <li key={request.otherId} className="friend-row">
                  <Avatar
                    className="friend-avatar"
                    name={request.otherName}
                    url={pictures.get(request.otherId)}
                  />
                  <span className="friend-main">
                    <strong className="friend-name">
                      <PlayerLink name={request.otherName} onOpen={onViewProfile} />
                    </strong>
                    <span className="friend-status">Request sent</span>
                  </span>
                  <span className="friend-actions">
                    <button
                      className="ghost small"
                      disabled={busy.has(request.otherId)}
                      onClick={() =>
                        void change(request.otherId, () => removeFriendship(userId, request.otherId))
                      }
                    >
                      Cancel
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!loaded ? (
            <p className="muted">Loading friends…</p>
          ) : rows.length === 0 ? (
            <p className="muted">No friends yet — press + Add friend and type a few letters of their name.</p>
          ) : (
            <ul className="list friend-list">
              {rows.map((row) => {
                const note = inviteNotes.get(row.profileId);
                const action = row.action;
                return (
                  <li key={row.profileId} className="friend-row">
                    <Avatar className="friend-avatar" name={row.name} url={pictures.get(row.profileId)} />
                    <span className="friend-main">
                      <strong className="friend-name">
                        <PlayerLink name={row.name} onOpen={onViewProfile} />
                      </strong>
                      <span className="friend-status">
                        <span className={`friend-dot ${row.dot}`} aria-hidden />
                        {row.statusText}
                      </span>
                    </span>
                    <span className="friend-actions">
                      {confirming === row.profileId ? (
                        <>
                          <span className="muted">Remove?</span>
                          <button className="ghost small" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                          <button
                            className="danger small"
                            disabled={busy.has(row.profileId)}
                            onClick={() => {
                              setConfirming(null);
                              void change(
                                row.profileId,
                                () => removeFriendship(userId, row.profileId),
                                `${row.name} is no longer your friend.`,
                              );
                            }}
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <>
                          {note ? (
                            <span className={`friend-note${note.failed ? ' failed' : ''}`}>
                              {note.text}
                            </span>
                          ) : (
                            action && (
                              <button
                                className="ghost small"
                                disabled={busy.has(row.profileId)}
                                onClick={() => run(row, action)}
                              >
                                {action.label}
                              </button>
                            )
                          )}
                          <button
                            className="ghost small friend-remove"
                            title={`Remove ${row.name}`}
                            aria-label={`Remove ${row.name} from your friends`}
                            onClick={() => setConfirming(row.profileId)}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
