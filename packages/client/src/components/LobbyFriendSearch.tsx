import type { OnlinePlayer, RoomSummary } from '@fmm/shared';
import { useEffect, useMemo } from 'react';
import { friendRows, groupFriendships } from '../data/friendsModel.js';
import type { Friendships } from '../data/useFriendships.js';
import { FriendSearch } from './FriendSearch.js';

/** How long "Request sent to X." stays up. There is no toggle here to clear it. */
const NOTICE_MS = 8_000;

interface Props {
  /** The signed-in viewer's profile id; null for a guest, who can look people up but not add them. */
  viewerProfileId: string | null;
  /** The viewer's friendships, kept by App — the same list the Friends card and the player cards use. */
  friends: Friendships;
  online: OnlinePlayer[];
  rooms: RoomSummary[];
  onViewProfile: (username: string) => void;
}

/**
 * "Find a player" in the lobby's Online now card: the same type-ahead as the
 * Friends card on /profile (friends first, Add / Accept / requested, a friend's
 * live Join / Watch, every name a link), and the same friendship logic — it is
 * the very same list (`useFriendships`, owned by App). The box is always there
 * rather than opened by a button.
 *
 * The lobby is only shown outside a room, so a friend's row can never offer
 * Invite (that needs a room of yours to invite them to).
 */
export function LobbyFriendSearch({ viewerProfileId, friends, online, rooms, onViewProfile }: Props) {
  const { notice, setNotice } = friends;

  const rows = useMemo(
    () => friendRows(groupFriendships(friends.friendships).accepted, online, rooms, null),
    [friends.friendships, online, rooms],
  );
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.profileId, row])), [rows]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  // The list is shared with the Friends card, so a line left behind here would turn up there.
  useEffect(() => () => setNotice(null), [setNotice]);

  return (
    <div className="lobby-search">
      <FriendSearch
        userId={viewerProfileId}
        friendships={friends.friendships}
        online={online}
        friendRows={rowsById}
        busy={friends.busy}
        inviteNotes={friends.inviteNotes}
        onAdd={friends.addFromSearch}
        onAccept={friends.acceptFromSearch}
        onFriendAction={friends.run}
        onViewProfile={onViewProfile}
        autoFocus={false}
      />

      {notice && (
        <p className={`${notice.failed ? 'form-error' : 'muted'} lobby-search-note`} role="status">
          {notice.text}
        </p>
      )}
      {friends.error && <p className="form-error lobby-search-note">{friends.error}</p>}
    </div>
  );
}
