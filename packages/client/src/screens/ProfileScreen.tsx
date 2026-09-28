import { STARTING_ELO, type ModerationResult, type OnlinePlayer, type RoomSummary } from '@fmm/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { FriendsPanel } from '../components/FriendsPanel.js';
import { ActivityHeatmap } from '../components/profile/ActivityHeatmap.js';
import { IdentityCard } from '../components/profile/IdentityCard.js';
import { RatingChart } from '../components/profile/RatingChart.js';
import { RecentMatches } from '../components/profile/RecentMatches.js';
import { winRate } from '../data/format.js';
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

/** How many matches the "Your recent matches" table lists. */
const RECENT_MATCHES = 10;

export interface ProfileScreenProps {
  /** Who is online right now — the lobby feed from useGame. */
  online: OnlinePlayer[];
  /** Open rooms, so a friend's room can offer Join or Watch. */
  rooms: RoomSummary[];
  /** The room this browser is in, or null. Inviting a friend needs one. */
  myRoomId: string | null;
  onJoin: (roomId: string) => void;
  onWatch: (roomId: string) => void;
  onInvite: (profileId: string) => Promise<ModerationResult>;
  onOpenGameLog: () => void;
}

/**
 * The signed-in player's page: who they are and their friends on the left;
 * their numbers, rating line, year of activity and recent matches on the right.
 *
 * Guests have no profile by design (their ratings are never persisted), so
 * they get an explanation rather than an error — and without Supabase at all
 * the page says so instead of crashing.
 */
export function ProfileScreen({
  online,
  rooms,
  myRoomId,
  onJoin,
  onWatch,
  onInvite,
  onOpenGameLog,
}: ProfileScreenProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [history, setHistory] = useState<ProfileHistoryRow[]>([]);
  const [standing, setStanding] = useState<{ rank: number; total: number | null } | null>(null);
  const [recent, setRecent] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

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
      // Fetched by id rather than with fetchMatchesForProfile, whose seat
      // lookup has no order and so is not guaranteed to return the newest.
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
    return (
      <EmptyState
        title="You’re playing as a guest"
        detail="Guest ratings aren’t saved between visits. Sign in from the home page to keep a profile, a rating and a match history."
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

  return (
    <div className="profile-layout">
      <div className="profile-side">
        <IdentityCard profile={profile} streak={streak} standing={standing} onRename={rename} />
        <FriendsPanel
          userId={userId}
          online={online}
          rooms={rooms}
          myRoomId={myRoomId}
          onJoin={onJoin}
          onWatch={onWatch}
          onInvite={onInvite}
        />
      </div>

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
        <RecentMatches matches={recent} userId={userId} onOpenGameLog={onOpenGameLog} />
      </div>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="profile-tile">
      <dt>{label}</dt>
      <dd className="profile-tile-value">{value}</dd>
      <dd className="muted">{detail}</dd>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
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
