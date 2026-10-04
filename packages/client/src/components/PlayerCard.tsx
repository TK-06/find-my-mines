import type { OnlinePlayer } from '@fmm/shared';
import { useEffect, useRef, useState } from 'react';
import { acceptFriendRequest, friendshipWith, sendFriendRequest } from '../data/friends.js';
import { PRIVATE_ROOM_TEXT, cardFriendButton, type Friendship } from '../data/friendsModel.js';
import { presenceLabel, winRate } from '../data/format.js';
import { pictureUrl } from '../data/avatar.js';
import {
  fetchProfile,
  fetchProfileHistory,
  fetchRank,
  type ProfileHistoryRow,
  type ProfileRow,
} from '../data/queries.js';
import { Avatar } from './Avatar.js';

export interface PlayerCardProps {
  player: OnlinePlayer;
  /** The signed-in viewer's profile id; null for a guest viewer. */
  viewerProfileId: string | null;
  onViewProfile: (username: string) => void;
  /** Opens the report dialog for this player (the card closes). */
  onReport: (player: OnlinePlayer) => void;
  onClose: () => void;
}

type Stats = {
  profile: ProfileRow | null;
  rank: { rank: number; total: number | null } | null;
  last: ProfileHistoryRow[];
};

const RESULT_LETTER = { win: 'W', loss: 'L', draw: 'D' } as const;
const RESULT_WORD = { win: 'win', loss: 'loss', draw: 'draw' } as const;

/**
 * A quick look at someone in the Online now list: their rating, record and
 * last few results, with View profile on the left, Add friend on the right,
 * and Report tucked behind the ⋯ button.
 *
 * Beside the list on a wide screen, a sheet from the bottom on a phone — the
 * same markup, laid out by the stylesheet. Esc, a click outside, or × closes it.
 */
export function PlayerCard({ player, viewerProfileId, onViewProfile, onReport, onClose }: PlayerCardProps) {
  const isAccount = player.profileId !== null && !player.isGuest;
  const [stats, setStats] = useState<Stats | null>(null);
  const [friendship, setFriendship] = useState<Friendship | null | 'unknown' | undefined>(undefined);
  const [friendBusy, setFriendBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);

  // Stats and the friendship, once per player.
  useEffect(() => {
    if (!isAccount || !player.profileId) return;
    const id = player.profileId;
    let live = true;
    void Promise.all([fetchProfile(id), fetchRank(id), fetchProfileHistory(id, 5)]).then(([profile, rank, last]) => {
      if (live) setStats({ profile, rank, last });
    });
    if (viewerProfileId && viewerProfileId !== id) {
      void friendshipWith(viewerProfileId, id).then((found) => {
        if (live) setFriendship(found);
      });
    }
    return () => {
      live = false;
    };
  }, [isAccount, player.profileId, viewerProfileId]);

  // Focus goes into the card when it opens, so Tab and Esc work from there.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (menuOpen) firstMenuItemRef.current?.focus();
  }, [menuOpen]);

  // Esc closes the menu first, then the card. A press outside closes the card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpen) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      } else {
        onClose();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      // A name in the list is handled by its own click: the same one closes, another switches.
      if (target.closest?.('[data-player-trigger]')) return;
      if (!cardRef.current?.contains(target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen, onClose]);

  const name = stats?.profile?.username ?? player.nickname;
  const where = player.privateRoom ? PRIVATE_ROOM_TEXT : presenceLabel(player);
  const dot = player.status === 'playing' ? 'playing' : 'online';
  const button = cardFriendButton(viewerProfileId !== null, friendship);

  async function pressFriend() {
    if (!player.profileId || !viewerProfileId || friendBusy || button.does === 'none') return;
    setFriendBusy(true);
    setNote(null);
    const result =
      button.does === 'accept'
        ? await acceptFriendRequest(viewerProfileId, player.profileId)
        : await sendFriendRequest(viewerProfileId, name);
    setFriendBusy(false);
    setNote({
      text: result.message ?? (result.ok ? (button.does === 'accept' ? `You and ${name} are friends now.` : 'Request sent.') : 'That did not work.'),
      failed: !result.ok,
    });
    if (result.ok) setFriendship(await friendshipWith(viewerProfileId, player.profileId));
  }

  async function copyName() {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Blocked (plain-http LAN, permissions): nothing to copy with. The name is right there to select.
    }
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  const profile = stats?.profile ?? null;
  const loading = isAccount && stats === null;

  return (
    <>
      {/* The phone sheet's dimmed backdrop; hidden beside the list on wide screens. */}
      <div className="player-card-backdrop" aria-hidden="true" />
      <div
        ref={cardRef}
        className="player-card"
        role="dialog"
        aria-label={`${name}'s player card`}
        tabIndex={-1}
      >
        <span className="player-card-handle" aria-hidden="true" />
        <div className="player-card-head">
          <Avatar
            className="player-card-avatar"
            name={name}
            url={player.avatarUrl ?? (profile ? pictureUrl(profile.id, profile.avatar_path) : null)}
            size={44}
          />
          <div className="player-card-who">
            <strong className="player-card-name">{name}</strong>
            <span className="player-card-where">
              <span className={`friend-dot ${dot}`} aria-hidden />
              {where}
              {player.isGuest && <span className="tag">guest</span>}
            </span>
          </div>
          <div className="player-card-menu-wrap">
            <button
              ref={menuButtonRef}
              type="button"
              className={`icon-button${menuOpen ? ' active' : ''}`}
              aria-label={`More actions for ${name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <div className="player-card-menu" role="menu" aria-label={`Actions for ${name}`}>
                <button ref={firstMenuItemRef} type="button" role="menuitem" onClick={() => void copyName()}>
                  <CopyIcon /> Copy username
                </button>
                <hr aria-hidden="true" />
                <button
                  type="button"
                  role="menuitem"
                  className="danger-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onReport(player);
                  }}
                >
                  <FlagIcon /> Report player…
                </button>
              </div>
            )}
          </div>
        </div>

        {isAccount ? (
          <>
            <dl className="player-card-stats" aria-busy={loading}>
              <div>
                <dt>{stats?.rank ? `Elo · #${stats.rank.rank}` : 'Elo'}</dt>
                <dd>{profile ? profile.elo.toLocaleString('en-US') : '—'}</dd>
              </div>
              <div>
                <dt>Win rate</dt>
                <dd>{profile ? `${winRate(profile.wins, profile.games_played)}%` : '—'}</dd>
              </div>
              <div>
                <dt>Ranked games</dt>
                <dd>{profile ? profile.games_played.toLocaleString('en-US') : '—'}</dd>
              </div>
            </dl>

            <div className="player-card-form">
              <span className="muted">Last {stats?.last.length || 5}</span>
              {stats && stats.last.length === 0 ? (
                <span className="muted">no matches yet</span>
              ) : (
                <span
                  className="form-squares"
                  role="img"
                  aria-label={
                    stats
                      ? `Last results, newest first: ${stats.last.map((m) => RESULT_WORD[m.outcome]).join(', ')}`
                      : 'Loading results'
                  }
                >
                  {(stats?.last ?? []).map((match) => (
                    <span key={match.match_id} className={`form-square ${match.outcome}`}>
                      {RESULT_LETTER[match.outcome]}
                    </span>
                  ))}
                </span>
              )}
            </div>

            <div className="player-card-actions">
              <button type="button" className="ghost" onClick={() => onViewProfile(name)}>
                View profile
              </button>
              <button
                type="button"
                className={button.primary ? '' : 'ghost'}
                disabled={button.does === 'none' || friendBusy}
                onClick={() => void pressFriend()}
              >
                {friendBusy ? 'Sending…' : button.label}
              </button>
            </div>
            <p role="status" className={`player-card-note${note?.failed ? ' failed' : ''}`}>
              {note?.text ?? button.note ?? ''}
            </p>
          </>
        ) : (
          <p className="muted player-card-guest">
            Playing as a guest, so there’s no profile to open or friend to add.
          </p>
        )}

        <span className="sr-only" role="status">
          {copied ? 'Username copied.' : ''}
        </span>
      </div>
    </>
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function DotsIcon() {
  return (
    <svg {...ICON}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...ICON}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg {...ICON}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4.5L17 13H5" />
    </svg>
  );
}
