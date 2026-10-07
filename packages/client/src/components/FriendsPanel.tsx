import type { ModerationResult, OnlinePlayer, ReportReason, RoomSummary } from '@fmm/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { acceptFriendRequest, removeFriendship } from '../data/friends.js';
import {
  MISSING_TABLE_MESSAGE,
  friendRows,
  groupFriendships,
  subjectOfPerson,
  type Friendship,
} from '../data/friendsModel.js';
import type { Friendships } from '../data/useFriendships.js';
import { Avatar } from './Avatar.js';
import { FriendSearch } from './FriendSearch.js';
import { PlayerCard, type CardInvite, type ReportTarget } from './PlayerCard.js';
import { ReportDialog } from './ReportDialog.js';

export interface FriendsPanelProps {
  /** The signed-in player's profile id. */
  userId: string;
  /**
   * Their friendships and the things done to them. Owned by App, so the lobby's
   * search and the player cards share one list with this card.
   */
  friends: Friendships;
  /** Who is online right now — the lobby feed from useGame. */
  online: OnlinePlayer[];
  /** Open rooms, so a friend's room can offer Join or Watch. */
  rooms: RoomSummary[];
  /** The room this browser is in, or null. Inviting from a row needs one. */
  myRoomId: string | null;
  /** What the card's Invite does from here, and how to send it. */
  invite: CardInvite;
  /** Reports a connection to the admins, from a card's ⋯ menu. */
  onReport: (targetId: string, reason: ReportReason, details: string) => Promise<ModerationResult>;
  /** Opens someone's public profile: the card's View profile. */
  onViewProfile: (username: string) => void;
}

/**
 * The friends list on the profile page: requests waiting on you, requests you
 * sent, then your friends and where each one is right now.
 *
 * Friendships live in Supabase (`useFriendships`, owned by App). Where a friend
 * is comes from the live online list, so a dot changes the moment they start or
 * leave a game — only the friendships themselves are refetched (on mount, after
 * every change, and when the window regains focus).
 *
 * A name opens that person's player card, the same one the lobby's Online now
 * list has — stats, how you have done against them, Invite, and Copy username,
 * Remove friend and Report behind ⋯ — and View profile goes to their page.
 */
export function FriendsPanel({
  userId,
  friends,
  online,
  rooms,
  myRoomId,
  invite,
  onReport,
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
    refresh,
    run,
  } = friends;

  const [adding, setAdding] = useState(false);
  /** The friend whose Remove is waiting for a second, deliberate click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The person whose card is open (profile id). */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Who the report dialog is about. Kept as a copy, so it stays put if they leave meanwhile. */
  const [reporting, setReporting] = useState<{ target: ReportTarget; openedFrom: string } | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const groups = useMemo(() => groupFriendships(friendships), [friendships]);
  const rows = useMemo(
    () => friendRows(groups.accepted, online, rooms, myRoomId),
    [groups, online, rooms, myRoomId],
  );
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.profileId, row])), [rows]);

  // The notice belongs to whoever shows it: the lobby's search shares this list, and a
  // line left over from there should not greet you here.
  useEffect(() => () => setNotice(null), [setNotice]);

  const openFriendship = openId ? friendships.find((f) => f.otherId === openId) : undefined;

  // They are no longer on the list (removed, or the request was withdrawn): there is nobody to show.
  useEffect(() => {
    if (openId && loaded && !openFriendship) setOpenId(null);
  }, [openId, loaded, openFriendship]);

  /** Close the card and put focus back on the name that opened it. */
  const closeCard = () => {
    const id = openId;
    setOpenId(null);
    // A removed friend's name is gone; the card's heading is the nearest place left.
    if (id) (triggers.current.get(id) ?? headingRef.current)?.focus();
  };

  /** A person's name, as the button that opens their card. */
  const nameButton = (otherId: string, name: string) => {
    const open = openId === otherId;
    return (
      <button
        ref={(node) => {
          if (node) triggers.current.set(otherId, node);
          else triggers.current.delete(otherId);
        }}
        type="button"
        className="online-name"
        data-player-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${name}'s card`}
        onClick={() => setOpenId(open ? null : otherId)}
      >
        {name}
      </button>
    );
  };

  /** Their card, when it is the one open — rendered inside their row, so it pops out beside it. */
  const cardFor = (friendship: Friendship) => {
    if (openId !== friendship.otherId) return null;
    const subject = subjectOfPerson(
      { profileId: friendship.otherId, name: friendship.otherName, picture: pictures.get(friendship.otherId) },
      online,
    );
    return (
      <PlayerCard
        // A fresh card per person, so one person's numbers never flash on another's.
        key={friendship.otherId}
        subject={subject}
        viewerProfileId={userId}
        placement="right"
        friendship={friendship}
        onViewProfile={(name) => {
          setOpenId(null);
          onViewProfile(name);
        }}
        onReport={(target) => {
          setOpenId(null);
          setReporting({ target, openedFrom: friendship.otherId });
        }}
        onRemoveFriend={() =>
          change(
            friendship.otherId,
            () => removeFriendship(userId, friendship.otherId),
            `${friendship.otherName} is no longer your friend.`,
          )
        }
        onFriendshipChanged={() => void refresh()}
        invite={invite}
        onClose={closeCard}
      />
    );
  };

  return (
    <section className="card friends-panel">
      <div className="friends-head">
        <h3 ref={headingRef} tabIndex={-1}>
          Friends · {groups.accepted.length}
        </h3>
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
                <li
                  key={request.otherId}
                  className={`friend-row${openId === request.otherId ? ' card-open' : ''}`}
                >
                  <Avatar
                    className="friend-avatar"
                    name={request.otherName}
                    url={pictures.get(request.otherId)}
                  />
                  <span className="friend-main">
                    <strong className="friend-name">{nameButton(request.otherId, request.otherName)}</strong>
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
                  {cardFor(request)}
                </li>
              ))}
            </ul>
          )}

          {groups.outgoing.length > 0 && (
            <ul className="list friend-list">
              {groups.outgoing.map((request) => (
                <li
                  key={request.otherId}
                  className={`friend-row${openId === request.otherId ? ' card-open' : ''}`}
                >
                  <Avatar
                    className="friend-avatar"
                    name={request.otherName}
                    url={pictures.get(request.otherId)}
                  />
                  <span className="friend-main">
                    <strong className="friend-name">{nameButton(request.otherId, request.otherName)}</strong>
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
                  {cardFor(request)}
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
                const friendship = groups.accepted.find((f) => f.otherId === row.profileId);
                return (
                  <li
                    key={row.profileId}
                    className={`friend-row${openId === row.profileId ? ' card-open' : ''}`}
                  >
                    <Avatar className="friend-avatar" name={row.name} url={pictures.get(row.profileId)} />
                    <span className="friend-main">
                      <strong className="friend-name">{nameButton(row.profileId, row.name)}</strong>
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
                    {friendship && cardFor(friendship)}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {reporting && (
        <ReportDialog
          targetId={reporting.target.id}
          targetName={reporting.target.name}
          onSend={(reason, details) => onReport(reporting.target.id, reason, details)}
          onClose={() => {
            const from = reporting.openedFrom;
            setReporting(null);
            triggers.current.get(from)?.focus();
          }}
        />
      )}
    </section>
  );
}
