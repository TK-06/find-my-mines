import { useCallback, useEffect, useRef, useState } from 'react';
import { authEnabled } from '../auth/supabase.js';
import { Avatar } from '../components/Avatar.js';
import { pictureUrl } from '../data/avatar.js';
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
  /** Your own row, and whether it is out of sight below: a phone then shows a "You" bar. */
  const myRow = useRef<HTMLLIElement>(null);
  const [meBelow, setMeBelow] = useState(false);

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

  const myIndex = rows.findIndex((row) => row.id === userId);
  useEffect(() => {
    const el = myRow.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      // Below the screen, not above it: scrolled past your row means you have seen it.
      setMeBelow(entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top > 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [myIndex]);

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

              return (
                <li key={row.id} className={isMe ? 'is-me' : undefined} ref={isMe ? myRow : undefined}>
                  <span className="rank-cell">
                    <span className="rank-number">{row.rank}</span>
                    <Avatar name={row.username} url={pictureUrl(row.id, row.avatar_path)} size={32} />
                    <span className="who">
                      {row.username}
                      {isMe && <span className="tag me">you</span>}
                    </span>
                  </span>
                  {/* Elo, record and win rate: under the name on a phone, columns on wider screens. */}
                  <span className="rank-stats">
                    <strong className="rank-elo">{row.elo}</strong>
                    <span className="muted rank-record">
                      {row.wins}W {row.losses}L {row.draws}D
                    </span>
                    <span className="muted rank-rate">{winRate(row.wins, row.games_played)}% won</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Phones only (styles.css): your place, while your row is further down. */}
      {meBelow && myIndex >= 0 && (
        <button
          type="button"
          className="rank-me-bar"
          onClick={() => myRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
        >
          <span>You</span>
          <strong>#{rows[myIndex]!.rank}</strong>
          <span>· {rows[myIndex]!.elo}</span>
          <span className="rank-me-go">Show me</span>
        </button>
      )}
    </div>
  );
}
