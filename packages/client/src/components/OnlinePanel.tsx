import type { ModerationResult, OnlinePlayer, ReportReason, RoomSummary } from '@fmm/shared';
import { useEffect, useRef, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { presenceLabel } from '../data/format.js';
import { PRIVATE_ROOM_TEXT } from '../data/friendsModel.js';
import { LobbyFriendSearch } from './LobbyFriendSearch.js';
import { PlayerCard } from './PlayerCard.js';
import { ReportDialog } from './ReportDialog.js';

interface Props {
  online: OnlinePlayer[];
  myId: string | null;
  /** Open rooms, to offer joining the game someone is in. */
  rooms: RoomSummary[];
  /** Same action as the game list's Join — an ask-to-join room opens the request. */
  onJoin: (roomId: string) => void;
  /** Spectate a friend's game, from the search's Watch button. */
  onWatch: (roomId: string) => void;
  /** Someone else's public profile page. */
  onViewProfile: (username: string) => void;
  /** Your own name goes straight to your profile. */
  onOpenOwnProfile: () => void;
  onReport: (targetId: string, reason: ReportReason, details: string) => Promise<ModerationResult>;
}

/**
 * Who else is connected, and where they are.
 *
 * Spec: "When a client is on the network, a client would connect to the
 * server first. Then, the server will provide information about the other
 * connected client." The server pushes this list on every change.
 *
 * The count is the headline. Under it, "Find a player" searches everyone (not
 * just who is connected); the list below stays the graded roster. Each name in
 * the list opens that player's card (stats, View profile, Add friend, and
 * Report behind ⋯); your own name opens your profile.
 */
export function OnlinePanel({
  online,
  myId,
  rooms,
  onJoin,
  onWatch,
  onViewProfile,
  onOpenOwnProfile,
  onReport,
}: Props) {
  // Yourself first, then everyone else in the order they connected.
  const ordered = [...online].sort((a, b) => Number(b.id === myId) - Number(a.id === myId));
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const viewerProfileId = online.find((p) => p.id === myId)?.profileId ?? null;

  /** The connection whose card is open. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Who the report dialog is about. Kept as a copy, so it stays put if they leave meanwhile. */
  const [reporting, setReporting] = useState<OnlinePlayer | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());

  const openPlayer = openId ? online.find((p) => p.id === openId) : undefined;

  // They left: there is nobody to show.
  useEffect(() => {
    if (openId && !openPlayer) setOpenId(null);
  }, [openId, openPlayer]);

  /** Close the card and put focus back on the name that opened it. */
  const closeCard = () => {
    const id = openId;
    setOpenId(null);
    if (id) triggers.current.get(id)?.focus();
  };

  return (
    <aside className="card online-panel">
      {/* The number is the news, so it is big; the heading still reads "N online now". */}
      <h3 className="online-count">
        <span className="online-count-number">{online.length}</span> <span className="online-count-label">online now</span>
      </h3>

      {/* Without Supabase there are no profiles to search, and a box that
          always says "nobody" would only look broken. */}
      {authEnabled && (
        <LobbyFriendSearch
          viewerProfileId={viewerProfileId}
          online={online}
          rooms={rooms}
          onJoin={onJoin}
          onWatch={onWatch}
          onViewProfile={onViewProfile}
        />
      )}

      {ordered.length <= 1 ? (
        <p className="muted" style={{ margin: 0 }}>
          Just you so far. Anyone who connects shows up here.
        </p>
      ) : null}

      <ul className="list online-list">
        {ordered.map((player) => {
          const room = player.roomId ? roomsById.get(player.roomId) : undefined;
          const isMe = player.id === myId;
          const canJoin = !isMe && room !== undefined && room.joinable;
          const open = openId === player.id;

          return (
            <li key={player.id} className={open ? 'card-open' : undefined}>
              <span className="online-who">
                <span className={`presence-dot ${player.status}`} aria-hidden />
                <button
                  ref={(node) => {
                    if (node) triggers.current.set(player.id, node);
                    else triggers.current.delete(player.id);
                  }}
                  type="button"
                  className="online-name"
                  data-player-trigger
                  aria-haspopup={isMe ? undefined : 'dialog'}
                  aria-expanded={isMe ? undefined : open}
                  title={isMe ? 'Your profile' : `${player.nickname}'s card`}
                  onClick={() => {
                    if (isMe) onOpenOwnProfile();
                    else setOpenId(open ? null : player.id);
                  }}
                >
                  {player.nickname}
                </button>
                {isMe && <span className="tag me">you</span>}
                {player.isGuest && <span className="tag">guest</span>}
              </span>
              <span className="online-where">
                {/* A private room's code is withheld, so there is nothing to join from here. */}
                <span className="muted">
                  {player.privateRoom ? PRIVATE_ROOM_TEXT : presenceLabel(player)}
                </span>
                {canJoin && (
                  <button className="ghost small" onClick={() => onJoin(room.id)}>
                    {room.config.joinByRequest ? 'Ask' : 'Join'}
                  </button>
                )}
              </span>

              {open && openPlayer && (
                <PlayerCard
                  // A fresh card per player, so one player's numbers never flash on another's.
                  key={openPlayer.id}
                  player={openPlayer}
                  viewerProfileId={viewerProfileId}
                  onViewProfile={(name) => {
                    setOpenId(null);
                    onViewProfile(name);
                  }}
                  onReport={(target) => {
                    setOpenId(null);
                    setReporting(target);
                  }}
                  onClose={closeCard}
                />
              )}
            </li>
          );
        })}
      </ul>

      {reporting && (
        <ReportDialog
          targetId={reporting.id}
          targetName={reporting.nickname}
          onSend={(reason, details) => onReport(reporting.id, reason, details)}
          onClose={() => {
            const id = reporting.id;
            setReporting(null);
            triggers.current.get(id)?.focus();
          }}
        />
      )}
    </aside>
  );
}
