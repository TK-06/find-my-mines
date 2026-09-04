import { useCallback, useEffect, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { winRate } from '../data/format.js';
import { currentUserId, fetchLeaderboard, type LeaderboardRow } from '../data/queries.js';

/**
 * Persistent all-time rankings, read from the `leaderboard` view.
 *
 * Guests never appear: their ratings are not stored, by design. Players with no
 * finished games are excluded by the view itself.
 */
export function LeaderboardScreen() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, id] = await Promise.all([fetchLeaderboard(50), currentUserId()]);
    setRows(list);
    setUserId(id);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!authEnabled) {
    return (
      <div className="card empty-state">
        <p style={{ margin: 0, fontWeight: 600 }}>Rankings are off</p>
        <p className="muted" style={{ marginBottom: 0 }}>
          No Supabase configuration was found, so no ratings are stored.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="lobby-head">
        <div>
          <h2 className="section-title">Rankings</h2>
          <p className="muted">
            {loading ? 'Loading…' : `Top ${rows.length} by Elo · ranked matches only`}
          </p>
        </div>
        <button className="ghost" disabled={loading} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="card empty-state">
          <p className="muted" style={{ margin: 0 }}>
            Loading rankings…
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <p style={{ margin: 0 }}>Nobody is ranked yet.</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Finish a <strong>Ranked</strong> match with a signed-in account to appear here.
            Guest ratings are never stored.
          </p>
        </div>
      ) : (
        <div className="card">
          <ul className="list rank-list">
            {rows.map((row) => {
              const isMe = row.id === userId;
              const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : null;

              return (
                <li key={row.id} className={isMe ? 'is-me' : undefined}>
                  <span className="rank-cell">
                    <span className="rank-number">{medal ?? row.rank}</span>
                    <span className="who">
                      {row.username}
                      {isMe && <span className="tag me">you</span>}
                    </span>
                  </span>
                  <span className="rank-stats">
                    <strong>{row.elo}</strong>
                    <span className="muted">
                      {' '}
                      · {row.wins}W {row.losses}L {row.draws}D ·{' '}
                      {winRate(row.wins, row.games_played)}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
