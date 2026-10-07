import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { acceptFriendRequest, friendshipWith, sendFriendRequest, type FriendsResult } from '../data/friends.js';
import {
  cardFriendButton,
  type CardSubject,
  type Friendship,
  type InviteOutcome,
  type InvitePlan,
} from '../data/friendsModel.js';
import { winRate } from '../data/format.js';
import { pictureUrl } from '../data/avatar.js';
import { describeHeadToHead, formatNetElo, formatRecord, type HeadToHead } from '../data/headToHead.js';
import {
  fetchHeadToHead,
  fetchProfile,
  fetchProfileHistory,
  fetchRank,
  type ProfileHistoryRow,
  type ProfileRow,
} from '../data/queries.js';
import { Avatar } from './Avatar.js';

/** Who the report dialog is about: the connection the server will look up, and the name for its title. */
export interface ReportTarget {
  id: string;
  name: string;
}

/** What Invite does from where the viewer is, and how to send it. */
export interface CardInvite {
  plan: InvitePlan;
  /**
   * Invite this friend. Sends at once from inside a room; otherwise parks the
   * invite until the game being set up exists and answers `queued`.
   */
  send: (friend: { profileId: string; name: string }) => Promise<InviteOutcome>;
}

export interface PlayerCardProps {
  subject: CardSubject;
  /** The signed-in viewer's profile id; null for a guest viewer. */
  viewerProfileId: string | null;
  /**
   * Which side of its row the card opens on, on a wide screen: to the `left`
   * (the lobby, whose list is the right-hand column) or to the `right` (the
   * Friends card, in the left-hand one). A phone gets a bottom sheet either way.
   */
  placement?: 'left' | 'right';
  /**
   * What the host already knows of the friendship — its own list has it. Left
   * out, the card reads it from the database when it opens.
   */
  friendship?: Friendship;
  onViewProfile: (username: string) => void;
  /** Opens the report dialog (the card closes). Only called while the person is online. */
  onReport: (target: ReportTarget) => void;
  /**
   * Unfriends them, through the host's own list so it refreshes and says so.
   * Left out, the ⋯ menu has no Remove friend.
   */
  onRemoveFriend?: () => Promise<FriendsResult>;
  /** The card added or accepted somebody: the host's list is out of date. */
  onFriendshipChanged?: () => void;
  invite: CardInvite;
  onClose: () => void;
}

type Stats = {
  profile: ProfileRow | null;
  rank: { rank: number; total: number | null } | null;
  last: ProfileHistoryRow[];
};

type Note = { text: string; failed: boolean };

const RESULT_LETTER = { win: 'W', loss: 'L', draw: 'D' } as const;
const RESULT_WORD = { win: 'win', loss: 'loss', draw: 'draw' } as const;

/**
 * How long the Invite button rests after one goes out. The server allows one
 * invite per friend every ten seconds, so pressing sooner could only be told no.
 */
const INVITE_AGAIN_MS = 10_000;

/**
 * A quick look at someone — in the lobby's Online now list, or among your
 * friends (who may be offline): their rating, record, last few results and how
 * you have done against them, with View profile on the left and the friend
 * button on the right (Add friend, or Invite once you are friends). Copy
 * username, Remove friend and Report live behind the ⋯ button.
 *
 * Beside its list on a wide screen, a sheet from the bottom on a phone — the
 * same markup, laid out by the stylesheet. Esc, a click outside, or × closes it.
 */
export function PlayerCard({
  subject,
  viewerProfileId,
  placement = 'left',
  friendship: knownFriendship,
  onViewProfile,
  onReport,
  onRemoveFriend,
  onFriendshipChanged,
  invite,
  onClose,
}: PlayerCardProps) {
  const isAccount = subject.profileId !== null && !subject.isGuest;
  const profileId = subject.profileId;
  /** Looking at someone else's account while signed in: the one case with a record to show. */
  const comparable = isAccount && viewerProfileId !== null && viewerProfileId !== profileId;

  const [stats, setStats] = useState<Stats | null>(null);
  /** undefined while loading; null is a failed read, shown as dashes rather than "no games". */
  const [h2h, setH2h] = useState<HeadToHead | null | undefined>(undefined);
  const [fetchedFriendship, setFetchedFriendship] = useState<Friendship | null | 'unknown' | undefined>(undefined);
  const [friendBusy, setFriendBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [justInvited, setJustInvited] = useState(false);
  const [copied, setCopied] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const h2hTitleId = useId();
  const reportHintId = useId();

  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  /** A timer that goes away with the card. */
  const later = (work: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      work();
    }, ms);
    timers.current.add(timer);
  };

  // Stats, once per person.
  useEffect(() => {
    if (!isAccount || !profileId) return;
    let live = true;
    void Promise.all([fetchProfile(profileId), fetchRank(profileId), fetchProfileHistory(profileId, 5)]).then(
      ([profile, rank, last]) => {
        if (live) setStats({ profile, rank, last });
      },
    );
    return () => {
      live = false;
    };
  }, [isAccount, profileId]);

  // How you have done against them: its own read, so the stats never wait on it.
  useEffect(() => {
    if (!comparable || !profileId || !viewerProfileId) return;
    let live = true;
    void fetchHeadToHead(viewerProfileId, profileId).then((result) => {
      if (live) setH2h(result);
    });
    return () => {
      live = false;
    };
  }, [comparable, viewerProfileId, profileId]);

  // The friendship, unless the host already has it.
  useEffect(() => {
    if (!comparable || !profileId || !viewerProfileId || knownFriendship) return;
    let live = true;
    void friendshipWith(viewerProfileId, profileId).then((found) => {
      if (live) setFetchedFriendship(found);
    });
    return () => {
      live = false;
    };
  }, [comparable, viewerProfileId, profileId, knownFriendship]);

  // Focus goes into the card when it opens, so Tab and Esc work from there.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  // Esc backs out one step at a time: the question, then the menu, then the
  // card. A press outside closes the card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmingRemove && !removing) {
        setConfirmingRemove(false);
        menuButtonRef.current?.focus();
      } else if (menuOpen) {
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
  }, [menuOpen, confirmingRemove, removing, onClose]);

  const profile = stats?.profile ?? null;
  const name = profile?.username ?? subject.name;
  const loading = isAccount && stats === null;

  const friendship = knownFriendship ?? fetchedFriendship;
  const online = subject.connectionId !== null;
  const button = cardFriendButton(viewerProfileId !== null, friendship, {
    friendOnline: online,
    plan: invite.plan,
  });
  const isFriend = comparable && friendship !== undefined && friendship !== null && friendship !== 'unknown' && friendship.status === 'accepted';
  const canRemove = isFriend && onRemoveFriend !== undefined;

  async function pressFriend() {
    if (!profileId || !viewerProfileId || friendBusy || button.does === 'none') return;
    setFriendBusy(true);
    setNote(null);

    if (button.does === 'invite') {
      const result = await invite.send({ profileId, name });
      if (!alive.current) return;
      setFriendBusy(false);
      // Parked until the game exists: the page is about to change under the card.
      if (result.queued) {
        onClose();
        return;
      }
      setNote(
        result.ok
          ? { text: 'Invited', failed: false }
          : { text: result.error ?? 'Could not invite.', failed: true },
      );
      if (result.ok) {
        setJustInvited(true);
        later(() => {
          setJustInvited(false);
          setNote((current) => (current?.text === 'Invited' ? null : current));
        }, INVITE_AGAIN_MS);
      }
      return;
    }

    const result =
      button.does === 'accept'
        ? await acceptFriendRequest(viewerProfileId, profileId)
        : await sendFriendRequest(viewerProfileId, name);
    if (!alive.current) return;
    setFriendBusy(false);
    setNote({
      text: result.message ?? (result.ok ? (button.does === 'accept' ? `You and ${name} are friends now.` : 'Request sent.') : 'That did not work.'),
      failed: !result.ok,
    });
    if (result.ok) {
      const found = await friendshipWith(viewerProfileId, profileId);
      if (!alive.current) return;
      setFetchedFriendship(found);
      onFriendshipChanged?.();
    }
  }

  async function removeFriend() {
    if (!onRemoveFriend || removing) return;
    setRemoving(true);
    setNote(null);
    const result = await onRemoveFriend();
    if (!alive.current) return;
    setRemoving(false);
    setConfirmingRemove(false);
    // The list has refreshed and said so itself; the card has nobody left to be about.
    if (result.ok) onClose();
    else setNote({ text: result.message ?? 'That did not work.', failed: true });
  }

  async function copyName() {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      later(() => setCopied(false), 1600);
    } catch {
      // Blocked (plain-http LAN, permissions): nothing to copy with. The name is right there to select.
    }
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  /** Arrow keys, Home and End move between the menu's items, as a menu should. */
  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(-1);
  }

  const visibleNote = note ?? (button.note ? { text: button.note, failed: false } : null);

  return (
    <>
      {/* The phone sheet's dimmed backdrop; hidden beside the list on wide screens. */}
      <div className="player-card-backdrop" aria-hidden="true" />
      <div
        ref={cardRef}
        className={`player-card${placement === 'right' ? ' placed-right' : ''}`}
        role="dialog"
        aria-label={`${name}'s player card`}
        tabIndex={-1}
      >
        <span className="player-card-handle" aria-hidden="true" />
        <div className="player-card-head">
          <Avatar
            className="player-card-avatar"
            name={name}
            url={subject.avatarUrl ?? (profile ? pictureUrl(profile.id, profile.avatar_path) : null)}
            size={44}
          />
          <div className="player-card-who">
            <strong className="player-card-name">{name}</strong>
            <span className="player-card-where">
              <span className={`friend-dot ${subject.dot}`} aria-hidden />
              {subject.where}
              {subject.isGuest && <span className="tag">guest</span>}
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
              <div
                ref={menuRef}
                className="player-card-menu"
                role="menu"
                aria-label={`Actions for ${name}`}
                onKeyDown={onMenuKey}
              >
                <button type="button" role="menuitem" onClick={() => void copyName()}>
                  <CopyIcon /> Copy username
                </button>
                {canRemove && (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmingRemove(true);
                    }}
                  >
                    <PersonMinusIcon /> Remove friend
                  </button>
                )}
                <hr aria-hidden="true" />
                {/* Only someone connected can be looked up by the server, so an
                    offline friend cannot be reported from here. It stays in the
                    menu, focusable, with its reason — not silently missing. */}
                <button
                  type="button"
                  role="menuitem"
                  className="danger-item"
                  aria-disabled={online ? undefined : true}
                  aria-describedby={online ? undefined : reportHintId}
                  onClick={() => {
                    if (subject.connectionId === null) return;
                    setMenuOpen(false);
                    onReport({ id: subject.connectionId, name });
                  }}
                >
                  <FlagIcon />
                  <span className="menu-item-text">
                    Report player…
                    {!online && (
                      <small id={reportHintId} className="menu-item-hint">
                        Only while they’re online
                      </small>
                    )}
                  </span>
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

            {comparable && (
              <section className="player-card-h2h" aria-labelledby={h2hTitleId} aria-busy={h2h === undefined}>
                <h4 id={h2hTitleId} className="player-card-h2h-title">
                  You vs {name}
                </h4>
                {h2h && h2h.games === 0 ? (
                  <p className="muted">No games yet</p>
                ) : (
                  <>
                    {/* Said in words for a screen reader; the figures below are for the eye. */}
                    {h2h && <span className="sr-only">{describeHeadToHead(h2h, name)}</span>}
                    <dl className="player-card-h2h-stats" aria-hidden={h2h ? true : undefined}>
                      <div>
                        <dt>W–L–D</dt>
                        <dd>{h2h ? formatRecord(h2h) : '—'}</dd>
                      </div>
                      <div>
                        <dt>Net Elo</dt>
                        {/* The sign says it; the colour only agrees. */}
                        <dd className={h2h && h2h.netElo > 0 ? 'gain' : h2h && h2h.netElo < 0 ? 'loss' : undefined}>
                          {h2h ? formatNetElo(h2h) : '—'}
                        </dd>
                      </div>
                    </dl>
                  </>
                )}
              </section>
            )}

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

            {confirmingRemove ? (
              <div className="player-card-confirm" role="group" aria-label={`Remove ${name} from your friends`}>
                <p>Remove {name} from your friends?</p>
                <div className="player-card-actions">
                  <button
                    type="button"
                    className="ghost"
                    autoFocus
                    disabled={removing}
                    onClick={() => {
                      setConfirmingRemove(false);
                      menuButtonRef.current?.focus();
                    }}
                  >
                    Keep
                  </button>
                  <button type="button" className="danger" disabled={removing} onClick={() => void removeFriend()}>
                    {removing ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="player-card-actions">
                <button type="button" className="ghost" onClick={() => onViewProfile(name)}>
                  View profile
                </button>
                <button
                  type="button"
                  className={button.primary ? '' : 'ghost'}
                  disabled={button.does === 'none' || friendBusy || justInvited}
                  onClick={() => void pressFriend()}
                >
                  {friendBusy ? (button.does === 'invite' ? 'Inviting…' : 'Sending…') : button.label}
                </button>
              </div>
            )}
            <p role="status" className={`player-card-note${visibleNote?.failed ? ' failed' : ''}`}>
              {visibleNote?.text ?? ''}
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

function PersonMinusIcon() {
  return (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" />
      <path d="M17.5 9.5h4.5" />
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
