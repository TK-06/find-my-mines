import {
  STARTING_ELO,
  type ModerationResult,
  type OnlinePlayer,
  type ReportReason,
  type RoomSummary,
} from '@fmm/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { FriendsPanel } from '../components/FriendsPanel.js';
import { Sheet } from '../components/Sheet.js';
import type { CardInvite } from '../components/PlayerCard.js';
import { ActivityHeatmap } from '../components/profile/ActivityHeatmap.js';
import { IdentityCard } from '../components/profile/IdentityCard.js';
import { RatingChart } from '../components/profile/RatingChart.js';
import { RecentMatches } from '../components/profile/RecentMatches.js';
import { winRate } from '../data/format.js';
import type { GuestProfile } from '../data/guestCookie.js';
import type { Friendships } from '../data/useFriendships.js';
import {
  bestElo,
  dayStreak,
  minesFound,
  ratingSeries,
  record,
} from '../data/profileStats.js';
import {
  currentUserId,
  fetchMatchesByIds,
  fetchProfile,
  fetchProfileHistory,
  fetchRank,
  updateUsername,
  type MatchRow,
  type ProfileHistoryRow,
  type ProfileRow,
} from '../data/queries.js';
import { useIsPhone } from '../useMediaQuery.js';

/** How many matches the "Your recent matches" table lists. */
const RECENT_MATCHES = 10;

export interface ProfileScreenProps {
  /** Who is online right now — the lobby feed from useGame. */
  online: OnlinePlayer[];
  /** Open rooms, so a friend's room can offer Join or Watch. */
  rooms: RoomSummary[];
  /** The room this browser is in, or null. Inviting a friend from a row needs one. */
  myRoomId: string | null;
  /** The signed-in player's friendships, kept by App (also read by the lobby and the waiting room). */
  friends: Friendships;
  /** What Invite does on a friend's card from here, and how it is sent. */
  invite: CardInvite;
  /** Reports a connected friend to the admins, from their card's ⋯ menu. */
  onReport: (targetId: string, reason: ReportReason, details: string) => Promise<ModerationResult>;
  /** Someone else's public profile: the View profile button on a friend's card. */
  onViewProfile: (username: string) => void;
  /** Opens a saved match's review, from the Review button on a recent match. */
  onOpenReview: (matchId: string) => void;
  /** The guest this browser remembers, unofficial rating and all; null for anyone else. */
  guest: GuestProfile | null;
  /** "Forget me": the cookie and the guest match history go. */
  onForgetGuest: () => void;
}

/**
 * The signed-in player's page: who they are and their friends on the left;
 * their numbers, rating line, year of activity and recent matches on the right.
 *
 * Guests have no profile by design (the server never persists their ratings), so
 * they get a small card of what this browser remembers — plainly unofficial —
 * and without Supabase at all the page says so instead of crashing.
 */
export function ProfileScreen({
  online,
  rooms,
  myRoomId,
  friends,
  invite,
  onReport,
  onViewProfile,
  onOpenReview,
  guest,
  onForgetGuest,
}: ProfileScreenProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [history, setHistory] = useState<ProfileHistoryRow[]>([]);
  const [standing, setStanding] = useState<{ rank: number; total: number | null } | null>(null);
  const [recent, setRecent] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  // On a phone the friends list is one line under your stats that opens in a sheet.
  const isPhone = useIsPhone();
  const [friendsOpen, setFriendsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const id = await currentUserId();
    setUserId(id);

    if (id) {
      const [row, seats, rank] = await Promise.all([
        fetchProfile(id),
        fetchProfileHistory(id),
        fetchRank(id),
      ]);
      // The history is newest first, so its first ids are the latest matches.
      // Reusing it (and fetching those matches by id) saves the extra lookup
      // fetchMatchesForProfile would make.
      const recentIds = [...new Set(seats.map((seat) => seat.match_id))].slice(0, RECENT_MATCHES);
      const matches = await fetchMatchesByIds(recentIds);

      setProfile(row);
      setHistory(seats);
      setStanding(rank);
      setRecent(matches);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Renaming only touches the profile row, so only that is re-read. */
  const rename = useCallback(
    async (name: string) => {
      if (!userId) return { ok: false, error: 'You are not signed in.' };
      const result = await updateUsername(userId, name);
      if (result.ok) {
        const row = await fetchProfile(userId);
        if (row) setProfile(row);
      }
      return result;
    },
    [userId],
  );

  // "Today" is fixed per load, so the heatmap and streak agree with each other.
  const today = useMemo(() => new Date(), [history]);
  const stats = useMemo(
    () => ({
      record: record(history),
      mines: minesFound(history),
      series: ratingSeries(history),
      streak: dayStreak(history, today),
    }),
    [history, today],
  );

  if (!authEnabled) {
    return (
      <EmptyState
        title="Accounts are off"
        detail="No Supabase configuration was found, so there are no profiles to show."
      />
    );
  }

  if (loading) return <EmptyState title="Loading your profile…" />;

  if (!userId) {
    if (guest) return <GuestCard guest={guest} onForget={onForgetGuest} />;
    return (
      <EmptyState
        title="You’re playing as a guest"
        detail="Guests have no official rating. Sign in from the home page to keep a profile, a rating and a match history."
      />
    );
  }

  if (!profile) {
    return (
      <EmptyState
        title="No profile yet"
        detail="Your account exists but has no profile row. It is created automatically on sign-up — if this persists, the database trigger may not be installed."
      />
    );
  }

  const { record: tally, mines, series, streak } = stats;
  const best = bestElo(history, profile.elo);

  const friendsPanel = (
    <FriendsPanel
      userId={userId}
      friends={friends}
      online={online}
      rooms={rooms}
      myRoomId={myRoomId}
      invite={invite}
      onReport={onReport}
      onViewProfile={(name) => {
        setFriendsOpen(false);
        onViewProfile(name);
      }}
    />
  );
  const accepted = friends.friendships.filter((f) => f.status === 'accepted').length;
  const waiting = friends.friendships.filter((f) => f.status === 'pending' && f.direction === 'incoming').length;

  // One column below desktop width: who you are, then your numbers, then your
  // friends (styles.css orders them); two columns from 1024px.
  return (
    <div className="profile-layout">
      <div className="profile-side">
        <IdentityCard profile={profile} streak={streak} standing={standing} onRename={rename} />
        {isPhone ? (
          <button type="button" className="card friends-summary" aria-haspopup="dialog" onClick={() => setFriendsOpen(true)}>
            <strong>Friends</strong>
            <span className="muted">
              {accepted} {accepted === 1 ? 'friend' : 'friends'}
              {waiting > 0 && ` · ${waiting} waiting on you`}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ) : (
          friendsPanel
        )}
      </div>
      {isPhone && friendsOpen && (
        <Sheet title="Friends" className="friends-sheet" onClose={() => setFriendsOpen(false)}>
          {friendsPanel}
        </Sheet>
      )}

      <div className="profile-main">
        <dl className="profile-tiles">
          <Tile
            label="Matches"
            value={tally.matches.toLocaleString('en-US')}
            detail={`${tally.ranked} ranked · ${tally.casual} casual`}
          />
          <Tile
            label="Win rate"
            value={`${winRate(tally.wins, tally.matches)}%`}
            detail={`${tally.wins}W ${tally.losses}L ${tally.draws}D`}
          />
          <Tile
            label="Mines found"
            value={mines.toLocaleString('en-US')}
            detail={tally.matches > 0 ? `${(mines / tally.matches).toFixed(1)} per match` : 'none yet'}
          />
          <Tile
            label="Best Elo"
            value={String(best)}
            detail={best > profile.elo ? `now ${profile.elo}` : 'your current rating'}
          />
        </dl>

        <RatingChart series={series} sinceJoining={profile.elo - STARTING_ELO} />
        <ActivityHeatmap seats={history} today={today} />
        <RecentMatches matches={recent} userId={userId} onOpenReview={onOpenReview} />
      </div>
    </div>
  );
}

/**
 * What this browser remembers of a guest: name, the unofficial rating it
 * worked out, and the ranked record. Everything is labelled unofficial because
 * the server never saw it. "Forget me" asks first, inline.
 */
function GuestCard({ guest, onForget }: { guest: GuestProfile; onForget: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="card guest-card" aria-labelledby="guest-card-title">
      <p className="muted guest-card-kicker">Guest · remembered in this browser for 30 days</p>
      <h2 id="guest-card-title" className="profile-name">
        {guest.name}
      </h2>

      <dl className="profile-tiles">
        <Tile label="Elo (unofficial)" value={String(guest.rating)} detail="worked out by this browser" />
        <Tile
          label="Ranked games"
          value={guest.games.toLocaleString('en-US')}
          detail={`${winRate(guest.wins, guest.games)}% won`}
        />
        <Tile label="Record" value={`${guest.wins}–${guest.losses}–${guest.draws}`} detail="wins · losses · draws" />
      </dl>

      <p className="muted">
        Only this browser knows this rating; the server rates every guest as {STARTING_ELO}. Sign in to keep a
        real rating.
      </p>

      {!confirming && (
        <div className="guest-card-actions">
          <button type="button" className="ghost" onClick={() => setConfirming(true)}>
            Forget me on this browser
          </button>
        </div>
      )}

      {confirming && (
        <div className="guest-forget" role="group" aria-label="Confirm forgetting this guest">
          <p>
            Forget {guest.name}? The name, the unofficial rating, the record and the list of matches this browser
            keeps are deleted. Matches already played stay recorded on the server.
          </p>
          <div className="guest-card-actions">
            <button type="button" onClick={onForget}>
              Yes, forget me
            </button>
            <button type="button" className="ghost" autoFocus onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="profile-tile">
      <dt>{label}</dt>
      <dd className="profile-tile-value">{value}</dd>
      <dd className="muted">{detail}</dd>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="card empty-state">
      <p style={{ margin: 0, fontWeight: 600 }}>{title}</p>
      {detail && (
        <p className="muted" style={{ marginBottom: 0 }}>
          {detail}
        </p>
      )}
    </div>
  );
}
