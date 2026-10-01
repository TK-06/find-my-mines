import {
  puzzleCellLabel,
  puzzleCellState,
  puzzleColumnName,
  type PuzzleCellState,
  type PuzzleGame,
} from '@fmm/shared';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { MineSprite } from '../MineSprite.js';
import { FlagSprite } from './FlagSprite.js';
import { cellAriaLabel } from './puzzleCopy.js';

interface Props {
  game: PuzzleGame;
  /** The cell the current hint points at, if any. */
  hint: { row: number; col: number } | null;
  /** Main click, Enter or Space: open a covered cell or chord a number. */
  onPlay: (row: number, col: number) => void;
  /** Right click, long press or F. */
  onFlag: (row: number, col: number) => void;
  /** Id of the text that explains the controls, for screen readers. */
  describedBy?: string;
}

/** How long a finger must rest on a cell to flag it, in milliseconds. */
const LONG_PRESS_MS = 400;
/** A finger that moves further than this is scrolling the board, not pressing. */
const PRESS_SLOP_PX = 10;

const CLASS_FOR: Record<PuzzleCellState, string> = {
  covered: 'cell covered',
  flagged: 'cell covered flagged',
  'wrong-flag': 'cell covered flagged wrong-flag',
  open: 'cell revealed empty',
  mine: 'cell revealed mine-shown',
  exploded: 'cell revealed bomb exploded',
};

/** The cell index behind an event, whichever child of the cell it landed on. */
function indexFrom(target: EventTarget | null): number | null {
  const cell = target instanceof Element ? target.closest('[data-index]') : null;
  if (!cell) return null;
  const index = Number(cell.getAttribute('data-index'));
  return Number.isInteger(index) ? index : null;
}

/**
 * The puzzle board, as an ARIA grid: one cell is in the tab order at a time
 * and the arrow keys move between cells (a roving tabindex), so a keyboard
 * player tabs into the board once rather than through 480 buttons.
 *
 * Input is handled once on the grid rather than on every cell. Mouse: left
 * click opens or chords, right click flags. Touch: tap opens, a long press
 * flags. Keyboard: arrows move, Enter or Space opens, F flags.
 */
export function PuzzleBoard({ game, hint, onPlay, onFlag, describedBy }: Props) {
  const { rows, cols } = game;
  const total = rows * cols;
  const [cursor, setCursor] = useState(0);
  // A new, smaller board keeps the cursor on it.
  const active = Math.min(cursor, total - 1);
  const gridRef = useRef<HTMLDivElement>(null);

  // The long-press timer outlives a render, so it reads the latest handlers.
  const handlers = useRef({ onPlay, onFlag });
  useEffect(() => {
    handlers.current = { onPlay, onFlag };
  });

  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  /** A long press just flagged; the click some browsers send on release must not also open. */
  const swallowClick = useRef(false);
  const lastPointer = useRef('mouse');

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  const at = (index: number) => ({ row: Math.floor(index / cols), col: index % cols });

  function focusCell(index: number) {
    setCursor(index);
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = indexFrom(event.target);
    if (index === null) return;
    lastPointer.current = 'keyboard';
    swallowClick.current = false;
    const { row, col } = at(index);
    let next: number;
    switch (event.key) {
      case 'ArrowUp':
        next = row > 0 ? index - cols : index;
        break;
      case 'ArrowDown':
        next = row < rows - 1 ? index + cols : index;
        break;
      case 'ArrowLeft':
        next = col > 0 ? index - 1 : index;
        break;
      case 'ArrowRight':
        next = col < cols - 1 ? index + 1 : index;
        break;
      case 'Home':
        next = event.ctrlKey ? 0 : row * cols;
        break;
      case 'End':
        next = event.ctrlKey ? total - 1 : row * cols + cols - 1;
        break;
      case 'f':
      case 'F':
        // Leave Ctrl+F and friends to the browser.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        handlers.current.onFlag(row, col);
        return;
      default:
        // Enter and Space reach the cell as a native button click.
        return;
    }
    event.preventDefault();
    focusCell(next);
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const index = indexFrom(event.target);
    if (index === null) return;
    setCursor(index);
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    const { row, col } = at(index);
    handlers.current.onPlay(row, col);
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const index = indexFrom(event.target);
    if (index === null) return;
    event.preventDefault();
    // On touch the long-press timer has already flagged; some browsers follow
    // it with a context menu event, which must not flag a second time.
    if (lastPointer.current === 'touch') return;
    setCursor(index);
    const { row, col } = at(index);
    handlers.current.onFlag(row, col);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    lastPointer.current = event.pointerType;
    swallowClick.current = false;
    cancelPress();
    if (event.pointerType !== 'touch') return;
    const index = indexFrom(event.target);
    if (index === null) return;
    const timer = window.setTimeout(() => {
      press.current = null;
      swallowClick.current = true;
      setCursor(index);
      const { row, col } = at(index);
      handlers.current.onFlag(row, col);
      // A short buzz where supported, so the flag is felt under the finger.
      try {
        navigator.vibrate?.(15);
      } catch {
        // No vibration — the flag still shows.
      }
    }, LONG_PRESS_MS);
    press.current = { x: event.clientX, y: event.clientY, timer };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > PRESS_SLOP_PX) cancelPress();
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    const index = indexFrom(event.target);
    if (index !== null) setCursor(index);
  }

  const live = game.status === 'ready' || game.status === 'playing';
  const style = { '--cols': cols, '--rows': rows } as CSSProperties;

  return (
    <div className={`puzzle-board${live ? ' live' : ''}`} style={style}>
      <div className="puzzle-row" aria-hidden="true">
        <span className="ruler corner" />
        {Array.from({ length: cols }, (_, col) => (
          <span key={col} className="ruler">
            {puzzleColumnName(col)}
          </span>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={`Minefield, ${cols} columns by ${rows} rows`}
        aria-describedby={describedBy}
        className="puzzle-grid"
        onKeyDown={onKeyDown}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onFocus={onFocus}
      >
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} role="row" className="puzzle-row">
            <span className="ruler" aria-hidden="true">
              {row + 1}
            </span>
            {Array.from({ length: cols }, (__, col) => {
              const index = row * cols + col;
              const state = puzzleCellState(game, index);
              const adjacent = game.adjacent[index]!;
              const hinted = hint?.row === row && hint?.col === col;
              let content: ReactNode = null;
              if (state === 'open') content = adjacent > 0 ? adjacent : '';
              else if (state === 'flagged') content = <FlagSprite />;
              else if (state === 'wrong-flag') content = <FlagSprite crossed />;
              else if (state === 'mine' || state === 'exploded') content = <MineSprite />;
              return (
                <button
                  key={col}
                  type="button"
                  role="gridcell"
                  data-index={index}
                  data-n={state === 'open' ? adjacent : undefined}
                  tabIndex={index === active ? 0 : -1}
                  className={hinted ? `${CLASS_FOR[state]} hinted` : CLASS_FOR[state]}
                  aria-label={cellAriaLabel(state, puzzleCellLabel({ row, col }), adjacent, hinted)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
