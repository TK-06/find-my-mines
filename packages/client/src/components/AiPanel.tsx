import {
  AI_BOARD_SIZES,
  AI_DEFAULT_SIZE,
  AI_DENSITIES,
  AI_HINTS_PER_MATCH,
  AI_LEVELS,
  AI_MODELS,
  AI_MODEL_NAME,
  type AiAbout,
  type AiDensity,
  type AiHintResult,
  type AiLevel,
  type AiModel,
  type PublicMatchState,
  type RoomActionResult,
  type ServerToClientEvents,
} from '@fmm/shared';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  AI_DENSITY_LABEL,
  AI_LEVEL_COPY,
    FLY_CREDIT,
  FLY_EXPLAINER,
  JEV_UNAVAILABLE,
  applyHintWhy,
  boardSummary,
  canAskHint,
  densityPercent,
  hintButtonLabel,
  hintVisible,
  isModelAvailable,
  isNewMatch,
  loadAiSetup,
  opponentNote,
  playLabel,
  boardChoiceLabel,
  playableModel,
  saveAiSetup,
  type AiSetup,
  type ShownHint,
} from '../data/aiPlay.js';
import { AiAboutDialog } from './AiAboutDialog.js';
import { Avatar } from './Avatar.js';
import { HintWithWhy } from './HintWithWhy.js';
import { useAiAbout } from './useAiAbout.js';

interface Props {
  connected: boolean;
  onPlay: (setup: AiSetup) => Promise<RoomActionResult>;
  /** Asks the server what its language model is, for the About dialog. */
  onAbout: () => Promise<AiAbout | null>;
  /**
   * Phones and tablets: the opponent and board pickers fold away behind one
   * Play button that says what it will start, with a Change button to open them.
   */
  compact?: boolean;
}

interface ChoiceOption<T extends string | number> {
  value: T;
  label: ReactNode;
  className?: string;
  /** Looks and reads as unavailable but stays focusable, so it can say why. */
  unavailable?: boolean;
}

/**
 * A radio group made of buttons: arrow keys move between the options (and
 * pick, as native radios do), only the picked one is in the Tab order, and
 * Enter or Space picks the one in focus. The look is the caller's classes.
 */
function Choice<T extends string | number>({
  labelledBy,
  describedBy,
  className,
  options,
  value,
  onChoose,
}: {
  labelledBy: string;
  describedBy?: string;
  className: string;
  options: ChoiceOption<T>[];
  value: T;
  onChoose: (value: T) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const at = radios.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    event.preventDefault();
    const next = (at + step + radios.length) % radios.length;
    radios[next]?.focus();
    const option = options[next];
    if (option) onChoose(option.value);
  }

  return (
    <div
      className={className}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={option.unavailable || undefined}
            tabIndex={checked ? 0 : -1}
            className={`ghost ${option.className ?? ''}${option.unavailable ? ' soon' : ''}`}
            onClick={() => onChoose(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The lobby's "Play vs AI" card, beside Quick match: choose an opponent, a
 * difficulty and a board, then Play. The last choice is remembered on this
 * device. A refusal shows as the usual toast (useGame handles it); success
 * swaps the lobby for the room, so this card simply goes away.
 */
export function AiPanel({ connected, onPlay, onAbout, compact = false }: Props) {
  const [setup, setSetup] = useState<AiSetup>(loadAiSetup);
  // Asked once when the card appears (the About dialog shares the answer):
  // JEV can only be played on a server that has its key.
  const about = useAiAbout(onAbout);
  /** What is shown and played: a remembered JEV gives way to the AI while it cannot be played. */
  const model = playableModel(setup.model, about);
  /** The opponent last clicked, playable or not: what "About" describes. */
  const [looking, setLooking] = useState<AiModel>(setup.model);
  const [soon, setSoon] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** Compact only: the pickers are showing. */
  const [expanded, setExpanded] = useState(false);
  /** Set while the game is being made, so a second click cannot make two. */
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const change = (patch: Partial<AiSetup>) => {
    const next = { ...setup, ...patch };
    setSetup(next);
    saveAiSetup(next);
  };

  function chooseModel(chosen: AiModel) {
    setLooking(chosen);
    if (!isModelAvailable(chosen, about)) {
      // Not selectable here: say why instead of silently ignoring the click.
      setSoon(JEV_UNAVAILABLE);
      return;
    }
    setSoon(null);
    change({ model: chosen });
  }

  async function play() {
    setStarting(true);
    await onPlay({ ...setup, model });
    if (alive.current) setStarting(false);
  }

  return (
    <section className="card ai-card" aria-labelledby="ai-card-title">
      <div>
        <h3 id="ai-card-title">Play vs AI</h3>
        <p className="muted">
          Casual · your rating doesn’t move. {AI_HINTS_PER_MATCH} hints a game.
        </p>
      </div>

      {compact && (
        <button
          type="button"
          className="ghost small ai-change"
          aria-expanded={expanded}
          aria-controls="ai-options"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Hide options' : 'Change opponent or board'}
        </button>
      )}

      <div id="ai-options" className="ai-options" hidden={compact && !expanded}>
      <div className="ai-field">
        <div className="ai-field-head">
          <span id="ai-opponent-label" className="field-label">
            Opponent
          </span>
          <button
            type="button"
            className="ai-about-button"
            aria-haspopup="dialog"
            onClick={() => setAboutOpen(true)}
          >
            <span className="ai-i" aria-hidden="true">
              i
            </span>
            About this opponent
          </button>
        </div>
        <Choice
          labelledBy="ai-opponent-label"
          className="ai-opponents"
          value={model}
          onChoose={chooseModel}
          options={AI_MODELS.map((option) => {
            const available = isModelAvailable(option, about);
            return {
              value: option,
              className: 'ai-tile',
              unavailable: !available,
              label: (
                <>
                  <Avatar name={AI_MODEL_NAME[option]} bot={option} size={40} />
                  <span className="ai-tile-name">{AI_MODEL_NAME[option]}</span>
                  <span className="ai-tile-note">{opponentNote(option, about)}</span>
                  {!available && <span className="ai-soon-tag">Off</span>}
                </>
              ),
            };
          })}
        />
        {/* Always rendered, so screen readers hear the message when it appears. */}
        <div role="status" aria-live="polite" className="ai-soon-status">
          {soon && !isModelAvailable('jev', about) && <p className="muted">{soon}</p>}
        </div>
        {/* The data's licence wants the credit wherever the circuit is used. */}
        {model === 'fly' && (
          <div className="fly-about">
            <p className="muted">{FLY_EXPLAINER}</p>
            <p className="fly-credit">
              <a href={FLY_CREDIT.href} target="_blank" rel="noreferrer">
                {FLY_CREDIT.text}
              </a>
              {' · '}
              <a href={FLY_CREDIT.licenseHref} target="_blank" rel="noreferrer">
                {FLY_CREDIT.license}
              </a>
            </p>
          </div>
        )}
      </div>

      <div className="ai-field">
        <span id="ai-level-label" className="field-label">
          Difficulty
        </span>
        <Choice<AiLevel>
          labelledBy="ai-level-label"
          describedBy="ai-level-note"
          className="ai-seg"
          value={setup.level}
          onChoose={(level) => change({ level })}
          options={AI_LEVELS.map((level) => ({
            value: level,
            className: 'ai-seg-option',
            label: AI_LEVEL_COPY[level].label,
          }))}
        />
        <p id="ai-level-note" className="muted">
          {AI_LEVEL_COPY[setup.level].note}
        </p>
      </div>

      <div className="ai-field">
        <span id="ai-size-label" className="field-label">
          Board size
        </span>
        <Choice<number>
          labelledBy="ai-size-label"
          className="ai-seg ai-seg-5"
          value={setup.size}
          onChoose={(size) => change({ size })}
          options={AI_BOARD_SIZES.map((size) => ({
            value: size,
            className: 'ai-seg-option',
            label: (
              <>
                {size}×{size}
                {size === AI_DEFAULT_SIZE && <span className="ai-seg-sub">Classic</span>}
              </>
            ),
          }))}
        />
      </div>

      <div className="ai-field">
        <span id="ai-density-label" className="field-label">
          Mines
        </span>
        <Choice<AiDensity>
          labelledBy="ai-density-label"
          describedBy="ai-summary"
          className="ai-seg"
          value={setup.density}
          onChoose={(density) => change({ density })}
          options={AI_DENSITIES.map((density) => ({
            value: density,
            className: 'ai-seg-option',
            label: (
              <>
                {AI_DENSITY_LABEL[density]}
                <span className="ai-seg-sub">{densityPercent(density)}</span>
              </>
            ),
          }))}
        />
        <p id="ai-summary" className="ai-summary">
          {boardSummary(setup.size, setup.density)}
        </p>
      </div>
      </div>

      <button type="button" className="ai-play" disabled={!connected || starting} onClick={() => void play()}>
        {starting ? 'Starting…' : playLabel(model, setup.level)}
        {compact && !expanded && <span className="ai-play-sub">{boardChoiceLabel(setup.size, setup.density)}</span>}
      </button>

      {aboutOpen && <AiAboutDialog model={looking} onAbout={onAbout} onClose={() => setAboutOpen(false)} />}
    </section>
  );
}

/** What the hint line under the turn banner says: the hint, or why there is none. */
export interface HintNote {
  text: string;
  failed: boolean;
  /** The explanation behind a hint, for its Why? button. A refusal has none. */
  why: string | null;
  /** Tells one hint from the next, so the Why? starts closed again for each. */
  id: number;
}

/**
 * The player's own hints in a game against the computer.
 *
 * Nothing here decides the game: the server picks the cell, counts the hints
 * and refuses when it must. This only keeps the answer on screen for as long
 * as it means something — until that cell is opened or the turn passes — and
 * shows how many are left as of the last answer (reset when a match starts).
 *
 * A hint comes with a plain "why". If the server's language model words it more
 * kindly a moment later (`ai:hintWhy`), that replaces it — but only while the
 * same hint is still on screen. `onHintWhy` subscribes to those and hands back
 * the way to unsubscribe.
 */
export function useAiHint(
  state: PublicMatchState | null,
  myId: string | null,
  askHint: () => Promise<AiHintResult>,
  onHintWhy: (listener: ServerToClientEvents['ai:hintWhy']) => () => void,
) {
  const [hint, setHint] = useState<ShownHint | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [hintsLeft, setHintsLeft] = useState(AI_HINTS_PER_MATCH);
  const [asking, setAsking] = useState(false);

  const previous = useRef<PublicMatchState | null>(null);
  /** Bumped per match, so an answer that lands after a rematch is dropped. */
  const match = useRef(0);
  /** Bumped per hint, so each starts with its Why? closed. */
  const hints = useRef(0);

  // The reworded explanation, for the hint on screen only. Unsubscribed with the component.
  useEffect(() => onHintWhy((update) => setHint((current) => applyHintWhy(current, update))), [onHintWhy]);

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
      hints.current += 1;
      setHint({
        row: result.row,
        col: result.col,
        text: result.text ?? '',
        why: result.why ? result.why : null,
        id: hints.current,
      });
    } else {
      setRefusal(result.error ?? 'No hint right now.');
    }
  }, [askHint]);

  const note: HintNote | null = shown
    ? { text: hint.text, failed: false, why: hint.why, id: hint.id }
    : refusal
      ? { text: refusal, failed: true, why: null, id: 0 }
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
      {/* Keyed by the hint, so a new one starts with its Why? closed. */}
      {note && (
        <HintWithWhy
          key={note.id}
          label={note.failed ? 'No hint' : 'Hint'}
          text={note.text}
          failed={note.failed}
          why={note.why}
        />
      )}
    </div>
  );
}
