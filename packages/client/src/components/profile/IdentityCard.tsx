import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { supabase } from '../../auth/supabase.js';
import { formatDay, initialOf, topPercent } from '../../data/profileStats.js';
import type { ProfileRow } from '../../data/queries.js';

interface Props {
  profile: ProfileRow;
  /** Consecutive days played, ending today or yesterday. */
  streak: number;
  /** Leaderboard position; null before the first ranked match. */
  standing: { rank: number; total: number | null } | null;
  /** Renames through updateUsername; resolves with its result. */
  onRename: (name: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Who you are: avatar letter, display name (renamed in place), how long you've
 * played, and your rating with its place on the leaderboard.
 *
 * The rating is only ever shown here — it is written by the game server, and a
 * database trigger ignores any client attempt to change it.
 */
export function IdentityCard({ profile, streak, standing, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.username);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  /** Set when the form closes, so focus goes back to the button that opened it. */
  const refocusEdit = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocusEdit.current) {
      refocusEdit.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  function startEditing() {
    setName(profile.username);
    setMessage(null);
    setEditing(true);
  }

  function cancel() {
    refocusEdit.current = true;
    setMessage(null);
    setEditing(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await onRename(name);
    setSaving(false);
    if (result.ok) {
      refocusEdit.current = true;
      setEditing(false);
      setMessage({ text: 'Saved.', failed: false });
    } else {
      setMessage({ text: result.error ?? 'Could not save.', failed: true });
    }
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault();
      cancel();
    }
  }

  const joined = new Date(profile.created_at);
  const since = [
    Number.isNaN(joined.getTime()) ? null : `Joined ${formatDay(joined)}`,
    streak >= 2 ? `played ${streak} days in a row` : null,
  ].filter(Boolean);

  const percent = standing ? topPercent(standing.rank, standing.total) : null;
  const eloCaption = [
    'Elo',
    standing ? `rank #${standing.rank}` : null,
    percent !== null ? `top ${percent}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const unchanged = name.trim() === profile.username || name.trim() === '';
  const client = supabase;

  return (
    <section className="card profile-id" aria-label="Your profile">
      <div className="profile-id-head">
        <div className="profile-avatar" aria-hidden="true">
          {initialOf(profile.username)}
        </div>

        <div className="profile-id-main">
          {editing ? (
            <form className="profile-rename" onSubmit={(e) => void save(e)} onKeyDown={onFormKeyDown}>
              <input
                ref={inputRef}
                type="text"
                value={name}
                maxLength={20}
                aria-label="Display name"
                aria-describedby="profile-rename-help"
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="profile-rename-actions">
                <button type="submit" className="small" disabled={saving || unchanged}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="ghost small" disabled={saving} onClick={cancel}>
                  Cancel
                </button>
              </div>
              <p id="profile-rename-help" className="muted">
                2–20 characters. Esc cancels.
              </p>
            </form>
          ) : (
            <div className="profile-name-row">
              <h2 className="profile-name">{profile.username}</h2>
              <button
                ref={editRef}
                type="button"
                className="ghost small"
                aria-label="Edit display name"
                onClick={startEditing}
              >
                edit
              </button>
            </div>
          )}
          {since.length > 0 && <p className="muted">{since.join(' · ')}</p>}
        </div>
      </div>

      {/* Always rendered, so screen readers announce the message when it appears. */}
      <p role="status" className={`profile-status ${message?.failed ? 'failed' : ''}`}>
        {message?.text}
      </p>

      <div className="profile-elo-row">
        <div>
          <p className="profile-elo">{profile.elo}</p>
          <p className="muted">{eloCaption}</p>
        </div>
        {client && (
          <button
            type="button"
            className="ghost small"
            onClick={() => void client.auth.signOut().then(() => window.location.reload())}
          >
            Sign out
          </button>
        )}
      </div>
    </section>
  );
}
