import { useCallback, useEffect, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { MatchCard } from '../components/MatchCard.js';
import { winRate } from '../data/format.js';
import {
  currentUserId,
  fetchMatchesForProfile,
  fetchProfile,
  updateUsername,
  type MatchRow,
  type ProfileRow,
} from '../data/queries.js';

/**
 * The signed-in player's profile: rating, record, and their recent matches.
 *
 * Guests have no profile by design (their ratings are never persisted), so
 * they get an explanation and a way back rather than an error.
 */
export function ProfileScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const id = await currentUserId();
    setUserId(id);

    if (id) {
      const [row, history] = await Promise.all([
        fetchProfile(id),
        fetchMatchesForProfile(id),
      ]);
      setProfile(row);
      setMatches(history);
      if (row) setName(row.username);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!userId) return;
    setSaving(true);
    setMessage(null);
    const result = await updateUsername(userId, name);
    setSaving(false);
    setFailed(!result.ok);
    setMessage(result.ok ? 'Saved.' : (result.error ?? 'Could not save.'));
    if (result.ok) void load();
  }

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

  const rate = winRate(profile.wins, profile.games_played);

  return (
    <div className="stack">
      <div className="stat-row">
        <Stat label="Rating" value={String(profile.elo)} />
        <Stat label="Games" value={String(profile.games_played)} />
        <Stat label="Win rate" value={`${rate}%`} />
        <Stat
          label="W / L / D"
          value={`${profile.wins} / ${profile.losses} / ${profile.draws}`}
          small
        />
      </div>

      <div className="card">
        <h3>Display name</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          This is the only thing you can change here — ratings are written by the game server.
        </p>
        <div className="name-row">
          <input
            type="text"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
          <button disabled={saving || name.trim() === profile.username} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {message && <p className={failed ? 'form-error' : 'muted'}>{message}</p>}
      </div>

      <div>
        <h3>Recent matches</h3>
        {matches.length === 0 ? (
          <div className="card empty-state">
            <p className="muted" style={{ margin: 0 }}>
              No matches yet. Play a game and it will show up here.
            </p>
          </div>
        ) : (
          <ul className="match-list">
            {matches.map((match) => (
              <MatchCard key={match.id} match={match} highlightProfileId={userId} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v" style={small ? { fontSize: 20 } : undefined}>
        {value}
      </div>
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
