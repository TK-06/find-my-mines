import { STARTING_ELO } from '@fmm/shared';
import { useEffect, useMemo, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { Avatar } from '../components/Avatar.js';
import { ActivityHeatmap } from '../components/profile/ActivityHeatmap.js';
import { RatingChart } from '../components/profile/RatingChart.js';
import { RecentMatches } from '../components/profile/RecentMatches.js';
import { pictureUrl } from '../data/avatar.js';
import { winRate } from '../data/format.js';
import { acceptFriendRequest, friendshipWith, sendFriendRequest } from '../data/friends.js';
import { cardFriendButton, type Friendship } from '../data/friendsModel.js';
import { bestElo, formatDay, minesFound, ratingSeries, record, topPercent } from '../data/profileStats.js';
import {
  currentUserId,
  fetchMatchesByIds,
  fetchProfileByUsername,
  fetchProfileHistory,
  fetchRank,
  type MatchRow,
  type ProfileHistoryRow,
  type ProfileRow,
} from '../data/queries.js';
import { EmptyState, Tile } from './ProfileScreen.js';

const RECENT_MATCHES = 10;

interface Props {
  username: string;
  /** Opens a saved match's review, from the Review button on a recent match. */
  onOpenReview: (matchId: string) => void;
  /** It turned out to be you: your own page has the edit controls. */
  onOpenOwnProfile: () => void;
}

interface Loaded {
  profile: ProfileRow;
  history: ProfileHistoryRow[];
  standing: { rank: number; total: number | null } | null;
  recent: MatchRow[];
}

/**
 * Someone else's profile, at /u/<username>: the same numbers, rating line,
 * year of activity and recent matches as your own page, read-only, with Add
 * friend. Everything here is public data, so it loads signed out too.
 */
export function PlayerProfileScreen({ username, onOpenReview, onOpenOwnProfile }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null | 'missing'>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [friendship, setFriendship] = useState<Friendship | null | 'unknown' | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    setFriendship(undefined);
    setNote(null);
    void (async () => {
      const [profile, me] = await Promise.all([fetchProfileByUsername(username), currentUserId()]);
      if (!live) return;
      setViewerId(me);
      if (!profile) {
        setLoaded('missing');
        return;
      }
      const [history, standing] = await Promise.all([fetchProfileHistory(profile.id), fetchRank(profile.id)]);
      const recentIds = [...new Set(history.map((seat) => seat.match_id))].slice(0, RECENT_MATCHES);
      const recent = await fetchMatchesByIds(recentIds);
      if (!live) return;
      setLoaded({ profile, history, standing, recent });
      if (me && me !== profile.id) {
        const found = await friendshipWith(me, profile.id);
        if (live) setFriendship(found);
      }
    })();
    return () => {
      live = false;
    };
  }, [username]);

  const history = loaded && loaded !== 'missing' ? loaded.history : null;
  const today = useMemo(() => new Date(), [history]);
  const stats = useMemo(
    () =>
      history
        ? { record: record(history), mines: minesFound(history), series: ratingSeries(history) }
        : null,
    [history],
  );

  if (!authEnabled) {
    return <EmptyState title="Accounts are off" detail="No Supabase configuration was found, so there are no profiles to show." />;
  }
  if (loaded === null) return <EmptyState title={`Loading ${username}…`} />;
  if (loaded === 'missing') {
    return (
      <EmptyState
        title={`No player called “${username}”`}
        detail="They may have changed their name. Guests have no profile page."
      />
    );
  }

  const { profile, standing, recent } = loaded;
  if (viewerId === profile.id) {
    return (
      <div className="card empty-state">
        <p style={{ margin: 0, fontWeight: 600 }}>This is you.</p>
        <p className="muted">Your own profile page has your friends and the edit controls.</p>
        <button type="button" onClick={onOpenOwnProfile}>
          Open my profile
        </button>
      </div>
    );
  }

  const tally = stats!.record;
  const best = bestElo(loaded.history, profile.elo);
  const button = cardFriendButton(viewerId !== null, friendship);
  const joined = new Date(profile.created_at);
  const percent = standing ? topPercent(standing.rank, standing.total) : null;

  async function pressFriend() {
    if (!viewerId || busy || button.does === 'none') return;
    setBusy(true);
    setNote(null);
    const result =
      button.does === 'accept'
        ? await acceptFriendRequest(viewerId, profile.id)
        : await sendFriendRequest(viewerId, profile.username);
    setBusy(false);
    setNote({
      text: result.message ?? (result.ok ? (button.does === 'accept' ? 'You’re friends now.' : 'Request sent.') : 'That did not work.'),
      failed: !result.ok,
    });
    if (result.ok) setFriendship(await friendshipWith(viewerId, profile.id));
  }

  return (
    <div className="profile-layout">
      <div className="profile-side">
        <section className="card profile-id" aria-label={`${profile.username}'s profile`}>
          <div className="profile-id-head">
            <Avatar className="profile-avatar" name={profile.username} url={pictureUrl(profile.id, profile.avatar_path)} size={56} />
            <div className="profile-id-main">
              <h2 className="profile-name">{profile.username}</h2>
              {!Number.isNaN(joined.getTime()) && <p className="muted">Joined {formatDay(joined)}</p>}
            </div>
          </div>
          <div className="profile-elo-row">
            <div>
              <p className="profile-elo">{profile.elo}</p>
              <p className="muted">
                {['Elo', standing ? `rank #${standing.rank}` : null, percent !== null ? `top ${percent}%` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <button
              type="button"
              className={button.primary ? '' : 'ghost'}
              disabled={button.does === 'none' || busy}
              onClick={() => void pressFriend()}
            >
              {busy ? 'Sending…' : button.label}
            </button>
          </div>
          <p role="status" className={`profile-status ${note?.failed ? 'failed' : ''}`}>
            {note?.text ?? button.note ?? ''}
          </p>
        </section>
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
            value={stats!.mines.toLocaleString('en-US')}
            detail={tally.matches > 0 ? `${(stats!.mines / tally.matches).toFixed(1)} per match` : 'none yet'}
          />
          <Tile label="Best Elo" value={String(best)} detail={best > profile.elo ? `now ${profile.elo}` : 'their current rating'} />
        </dl>

        <RatingChart series={stats!.series} sinceJoining={profile.elo - STARTING_ELO} own={false} />
        <ActivityHeatmap seats={loaded.history} today={today} />
        <RecentMatches
          matches={recent}
          userId={profile.id}
          title="Recent matches"
          onOpenReview={onOpenReview}
        />
      </div>
    </div>
  );
}
