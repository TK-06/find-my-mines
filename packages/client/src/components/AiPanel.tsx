import {
  AI_HINTS_PER_MATCH,
  AI_LEVELS,
  type AiHintResult,
  type AiLevel,
  type PublicMatchState,
  type RoomActionResult,
} from '@fmm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AI_LEVEL_COPY,
  canAskHint,
  hintButtonLabel,
  hintVisible,
  isNewMatch,
} from '../data/aiPlay.js';

interface Props {
  connected: boolean;
  onPlay: (level: AiLevel) => Promise<RoomActionResult>;
}

/**
 * The lobby's "Play vs AI" card, beside Quick match: one click per level and
 * the game starts. A refusal shows as the usual toast (useGame handles it);
 * success swaps the lobby for the room, so this card simply goes away.
 */
export function AiPanel({ connected, onPlay }: Props) {
  /** The level whose game is being set up, so a second click cannot make two. */
  const [starting, setStarting] = useState<AiLevel | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function play(level: AiLevel) {
    setStarting(level);
    await onPlay(level);
    if (alive.current) setStarting(null);
  }

  return (
    <section className="card ai-card" aria-labelledby="ai-card-title">
      <div>
        <h3 id="ai-card-title">Play vs AI</h3>
        <p className="muted">A computer opponent on a Classic board. Casual — your rating doesn't move.</p>
      </div>
      <div className="ai-levels" role="group" aria-label="Difficulty">
        {AI_LEVELS.map((level) => {
          const copy = AI_LEVEL_COPY[level];
          return (
            <button
              key={level}
              type="button"
              className="ghost ai-level"
              disabled={!connected || starting !== null}
              onClick={() => void play(level)}
            >
              <span className="ai-level-name">{starting === level ? 'Starting…' : copy.label}</span>{' '}
              <span className="ai-level-note">{copy.note}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** What the hint line under the turn banner says: the hint, or why there is none. */
export interface HintNote {
  text: string;
  failed: boolean;
}

/**
 * The player's own hints in a game against the computer.
 *
 * Nothing here decides the game: the server picks the cell, counts the hints
 * and refuses when it must. This only keeps the answer on screen for as long
 * as it means something — until that cell is opened or the turn passes — and
 * shows how many are left as of the last answer (reset when a match starts).
 */
export function useAiHint(
  state: PublicMatchState | null,
  myId: string | null,
  askHint: () => Promise<AiHintResult>,
) {
  const [hint, setHint] = useState<{ row: number; col: number; text: string } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [hintsLeft, setHintsLeft] = useState(AI_HINTS_PER_MATCH);
  const [asking, setAsking] = useState(false);

  const previous = useRef<PublicMatchState | null>(null);
  /** Bumped per match, so an answer that lands after a rematch is dropped. */
  const match = useRef(0);

  useEffect(() => {
    if (state && isNewMatch(previous.current, state)) {
      match.current += 1;
      setHint(null);
      setRefusal(null);
      setHintsLeft(AI_HINTS_PER_MATCH);
      setAsking(false);
    }
    previous.current = state;
  }, [state]);

  const available = canAskHint(state, myId);
  const shown = hint !== null && hintVisible(hint, state, myId);

  // Cleared for good the first time it stops applying, so it does not come
  // back when the turn does. Render already hides it (`shown`) in between.
  useEffect(() => {
    if (hint && !shown) setHint(null);
    if (refusal && !available) setRefusal(null);
  }, [hint, shown, refusal, available]);

  const request = useCallback(async () => {
    const asked = match.current;
    setAsking(true);
    setRefusal(null);
    const result = await askHint();
    if (asked !== match.current) return;
    setAsking(false);
    if (typeof result.hintsLeft === 'number') setHintsLeft(result.hintsLeft);
    if (result.ok && typeof result.row === 'number' && typeof result.col === 'number') {
      setHint({ row: result.row, col: result.col, text: result.text ?? '' });
    } else {
      setRefusal(result.error ?? 'No hint right now.');
    }
  }, [askHint]);

  const note: HintNote | null = shown
    ? { text: hint.text, failed: false }
    : refusal
      ? { text: refusal, failed: true }
      : null;

  return {
    /** Offer the button at all: a game against the computer, seated, your turn. */
    available,
    /** The covered cell to highlight on the board, or null. */
    cell: shown ? { row: hint.row, col: hint.col } : null,
    note,
    hintsLeft,
    asking,
    // One hint on the board at a time: asking again would spend another on
    // the same cell.
    canRequest: available && !asking && !shown && hintsLeft > 0,
    request,
  };
}

/** The Hint button, inside the turn banner. */
export function HintButton({
  hintsLeft,
  asking,
  disabled,
  onClick,
}: {
  hintsLeft: number;
  asking: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="hint-button" disabled={disabled} onClick={onClick}>
      {asking ? 'Thinking…' : hintButtonLabel(hintsLeft)}
    </button>
  );
}

/**
 * The hint's reason (or the refusal), under the banner. Only this browser
 * has it — the server answers the asker alone.
 */
export function HintLine({ note }: { note: HintNote | null }) {
  // Always rendered, so screen readers hear each new hint as it arrives.
  return (
    <div role="status" aria-live="polite" className="hint-status">
      {note && (
        <p className={`hint-note${note.failed ? ' failed' : ''}`}>
          <span className="hint-mark" aria-hidden="true" />
          <span>
            <strong>{note.failed ? 'No hint' : 'Hint'}</strong>
            {note.text ? ` · ${note.text}` : ''}
          </span>
        </p>
      )}
    </div>
  );
}
