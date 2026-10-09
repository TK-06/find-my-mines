import { AI_MODEL_NAME, type QueueSnapshot } from '@fmm/shared';
import type { ReactNode } from 'react';
import { AI_LEVEL_COPY, loadAiSetup } from '../data/aiPlay.js';
import type { LobbyMode } from '../data/layout.js';

interface Props {
  /** Open games right now, for the Join line. */
  openGames: number;
  /** The quick-match search, when one is running. */
  queue: QueueSnapshot | null;
  onOpen: (mode: LobbyMode) => void;
}

/**
 * The Play page on a phone: three ways to start a game, each one tap away,
 * instead of every panel stacked down a long page. Each opens a screen with
 * only that part of the lobby (see PhoneLobbyMode). Wider screens keep the
 * full lobby.
 */
export function PhoneLobbyMenu({ openGames, queue, onOpen }: Props) {
  // Read now, so the line under Play vs AI names what you last picked.
  const ai = loadAiSetup();
  return (
    <nav className="phone-lobby-menu" aria-label="Ways to play">
      <MenuButton
        title="Join a game"
        detail={`${openGames} open · by code · or create one`}
        icon={<path d="M4 6h16v12H4zM4 10h16M9 14h6" />}
        onClick={() => onOpen('games')}
      />
      <MenuButton
        title="Quick match"
        detail={queue ? `Searching for a ${queue.mode} match…` : 'Paired with someone near your rating'}
        busy={queue !== null}
        icon={<path d="M13 3 5 14h6l-1 7 8-11h-6z" />}
        onClick={() => onOpen('quick')}
      />
      <MenuButton
        title="Play vs AI"
        detail={`${AI_MODEL_NAME[ai.model]} · ${AI_LEVEL_COPY[ai.level].label} · ${ai.size}×${ai.size}`}
        icon={
          <>
            <rect x="5" y="8" width="14" height="11" rx="2" />
            <path d="M12 4v4M9 13h.01M15 13h.01M10 16h4" />
          </>
        }
        onClick={() => onOpen('ai')}
      />
    </nav>
  );
}

function MenuButton({
  title,
  detail,
  icon,
  busy = false,
  onClick,
}: {
  title: string;
  detail: string;
  icon: ReactNode;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`phone-lobby-button${busy ? ' busy' : ''}`} onClick={onClick}>
      <svg
        className="phone-lobby-icon"
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icon}
      </svg>
      <span className="phone-lobby-text">
        <span className="phone-lobby-title">{title}</span>
        <span className="phone-lobby-detail">
          {busy && <span className="pulse-dot" aria-hidden="true" />}
          {detail}
        </span>
      </span>
      <span className="phone-lobby-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/** The top of a mode's screen: back to the menu, and what this screen is. */
export function PhoneLobbyHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="phone-lobby-head">
      <button type="button" className="ghost phone-lobby-back" onClick={onBack}>
        <span aria-hidden="true">‹</span> Back
      </button>
      <h2 className="section-title phone-lobby-heading">{title}</h2>
    </div>
  );
}
