import { useCallback, useEffect, useMemo, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { MatchCard } from '../components/MatchCard.js';
import { loadGuestMatches, type GuestMatch } from '../data/guestHistory.js';
import {
  currentUserId,
  fetchMatchesByIds,
  fetchMatchesForProfile,
  fetchRecentMatches,
  type MatchRow,
} from '../data/queries.js';

type Scope = 'all' | 'mine';
type ModeFilter = 'all' | 'ranked' | 'casual';

/** Public match history. Anyone can read it; guests included in the seats. */
export function GameLogScreen() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [guestMatches, setGuestMatches] = useState<GuestMatch[]>(() => loadGuestMatches());
  const [scope, setScope] = useState<Scope>('all');
  const [mode, setMode] = useState<ModeFilter>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (which: Scope) => {
    setLoading(true);
    const id = await currentUserId();
    setUserId(id);
    const history = loadGuestMatches();
    setGuestMatches(history);

    // "Mine" is an account's matches — or, for a guest, the matches this
    // browser remembers playing.
    const rows =
      which === 'mine' && id
        ? await fetchMatchesForProfile(id, 40)
        : which === 'mine'
          ? await fetchMatchesByIds(history.map((m) => m.matchId))
          : await fetchRecentMatches(40);
    setMatches(rows);
    setLoading(false);
  }, []);

  /** Which name this browser played each remembered match under. */
  const guestNames = useMemo(
    () => new Map(guestMatches.map((m) => [m.matchId, m.nickname])),
    [guestMatches],
  );
  const canShowMine = Boolean(userId) || guestMatches.length > 0;

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  const visible = mode === 'all' ? matches : matches.filter((m) => m.mode === mode);

  if (!authEnabled) {
    return (
      <div className="card empty-state">
        <p style={{ margin: 0, fontWeight: 600 }}>Match history is off</p>
        <p className="muted" style={{ marginBottom: 0 }}>
          No Supabase configuration was found. Games still work — they just aren’t recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="lobby-head">
        <div>
          <h2 className="section-title">Game log</h2>
          <p className="muted">
            {loading ? 'Loading…' : `${visible.length} match${visible.length === 1 ? '' : 'es'}`}
          </p>
        </div>
        <button className="ghost" disabled={loading} onClick={() => void load(scope)}>
          Refresh
        </button>
      </div>

      <div className="filter-row">
        <div className="preset-row">
          <button className={scope === 'all' ? '' : 'ghost'} onClick={() => setScope('all')}>
            Everyone
          </button>
          <button
            className={scope === 'mine' ? '' : 'ghost'}
            disabled={!canShowMine}
            onClick={() => setScope('mine')}
            title={
              userId
                ? undefined
                : canShowMine
                  ? 'Games you played as a guest in this browser'
                  : 'Finish a game, or sign in, to see your own'
            }
          >
            Mine
          </button>
          {scope === 'mine' && !userId && (
            <span className="muted">Played as a guest in this browser</span>
          )}
        </div>

        <div className="preset-row">
          {(['all', 'ranked', 'casual'] as ModeFilter[]).map((option) => (
            <button
              key={option}
              className={mode === option ? '' : 'ghost'}
              onClick={() => setMode(option)}
            >
              {option === 'all' ? 'All modes' : option}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card empty-state">
          <p className="muted" style={{ margin: 0 }}>
            Loading matches…
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card empty-state">
          <p style={{ margin: 0 }}>No matches recorded yet.</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Finish a game and it will appear here.
          </p>
        </div>
      ) : (
        <ul className="match-list">
          {visible.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              highlightProfileId={userId}
              highlightGuestName={userId ? null : (guestNames.get(match.id) ?? null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
