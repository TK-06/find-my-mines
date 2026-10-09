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
import { indexAt, moveInView, viewSize } from './boardView.js';
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
  /**
   * Draw the board turned upright (game columns down the screen), for a board
   * wider than the screen can show (Hard on a phone). See boardView.ts.
   */
  transposed?: boolean;
}

/** Wider than this many columns on screen, a phone drops the rulers to give the cells their room. */
const DENSE_COLS = 12;

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
export function PuzzleBoard({ game, hint, onPlay, onFlag, describedBy, transposed = false }: Props) {
  const { rows, cols } = game;
  const total = rows * cols;
  const { viewRows, viewCols } = viewSize(rows, cols, transposed);
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
    if (event.key === 'f' || event.key === 'F') {
      // Leave Ctrl+F and friends to the browser.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      const { row, col } = at(index);
      handlers.current.onFlag(row, col);
      return;
    }
    // Arrow keys follow the screen, so on an upright board Down is still the cell
    // drawn below. Enter and Space reach the cell as a native button click.
    const next = moveInView(index, event.key, rows, cols, transposed, event.ctrlKey);
    if (next === null) return;
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
  // The screen's columns and rows: swapped when the board is drawn upright.
  const style = { '--cols': viewCols, '--rows': viewRows } as CSSProperties;
  // The rulers name game columns by letter and game rows by number, wherever they are drawn.
  const rulerFor = (axis: 'top' | 'side', n: number) =>
    (axis === 'top') !== transposed ? puzzleColumnName(n) : String(n + 1);

  return (
    <div
      className={`puzzle-board${live ? ' live' : ''}${transposed ? ' upright' : ''}`}
      style={style}
      data-dense={viewCols > DENSE_COLS ? '' : undefined}
    >
      <div className="puzzle-row" aria-hidden="true">
        <span className="ruler corner" />
        {Array.from({ length: viewCols }, (_, col) => (
          <span key={col} className="ruler">
            {rulerFor('top', col)}
          </span>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={`Minefield, ${cols} columns by ${rows} rows${transposed ? ', turned upright: columns run down the screen' : ''}`}
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
        {Array.from({ length: viewRows }, (_, viewRow) => (
          <div key={viewRow} role="row" className="puzzle-row">
            <span className="ruler" aria-hidden="true">
              {rulerFor('side', viewRow)}
            </span>
            {Array.from({ length: viewCols }, (__, viewCol) => {
              const index = indexAt(viewRow, viewCol, cols, transposed);
              const row = Math.floor(index / cols);
              const col = index % cols;
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
                  key={viewCol}
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
