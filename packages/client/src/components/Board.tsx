import { TURN_SECONDS, type MinePosition, type PublicMatchState, type RevealedCell } from '@fmm/shared';
import type { CSSProperties } from 'react';
import { MineSprite } from './MineSprite.js';

interface Props {
  state: PublicMatchState;
  /** True when this browser owns the current turn. */
  myTurn: boolean;
  onReveal: (row: number, col: number) => void;
  /**
   * Server console only: where the hidden mines are. A game client never has
   * this — the server sends mine positions solely on the /admin namespace.
   */
  mines?: MinePosition[] | null;
  /**
   * Games against the computer: the covered cell the player's last hint
   * pointed at. Only ever this player's own — the hint is never broadcast.
   */
  hint?: { row: number; col: number } | null;
  /**
   * Phones only, for boards over 12 columns: full-size cells that scroll inside
   * the board, instead of shrinking every cell to fit the screen's width.
   */
  zoomed?: boolean;
}

/** Wider than this, a phone drops the rulers to give the cells their room. */
const DENSE_COLS = 12;

/** Index the reveal history by cell for O(1) lookup while rendering. */
function revealMap(revealed: RevealedCell[]): Map<string, RevealedCell> {
  return new Map(revealed.map((cell) => [`${cell.row}:${cell.col}`, cell]));
}

/** Column letters, A–P for the largest 16-wide board. */
const colName = (col: number) => String.fromCharCode(65 + col);

/**
 * The board as a survey grid: lettered columns, numbered rows, and the turn
 * clock as a line along the top edge that drains while the turn runs.
 *
 * Its cells are sized from the board's own width (see .board in styles.css),
 * so the grid always ends flush with the board's edge, whatever the screen.
 */
export function Board({ state, myTurn, onReveal, mines, hint, zoomed = false }: Props) {
  const revealed = revealMap(state.revealed);
  const hiddenMines = new Set((mines ?? []).map((m) => `${m.row}:${m.col}`));
  const interactive = myTurn && state.status === 'playing';
  const playing = state.status === 'playing';
  const remaining = playing ? Math.max(0, state.secondsLeft) / TURN_SECONDS : 0;

  const style = { '--cols': state.cols } as CSSProperties;

  return (
    <div
      className={`board${interactive ? ' my-turn' : ''}${zoomed ? ' zoomed' : ''}`}
      style={style}
      data-dense={state.cols > DENSE_COLS ? '' : undefined}
    >
      <div className="board-clock" aria-hidden="true">
        <i
          className={playing && state.secondsLeft <= 3 ? 'urgent' : ''}
          style={{ transform: `scaleX(${remaining})` }}
        />
      </div>

      <div className="board-grid">
        <span className="ruler corner" aria-hidden="true" />
        {Array.from({ length: state.cols }, (_, col) => (
          <span key={`c${col}`} className="ruler" aria-hidden="true">
            {colName(col)}
          </span>
        ))}

        {Array.from({ length: state.rows }).flatMap((_, row) => [
          <span key={`r${row}`} className="ruler" aria-hidden="true">
            {row + 1}
          </span>,
          ...Array.from({ length: state.cols }, (__, col) => {
            const cell = revealed.get(`${row}:${col}`);
            const where = `${colName(col)}${row + 1}`;

            if (!cell && hiddenMines.has(`${row}:${col}`)) {
              return (
                <button
                  key={`${row}:${col}`}
                  className="cell hidden-mine"
                  disabled
                  aria-label={`${where}, covered, mine`}
                >
                  <MineSprite />
                </button>
              );
            }

            if (!cell) {
              // Said in the label too, not only drawn: "C4, covered, hinted".
              const hinted = hint?.row === row && hint?.col === col;
              return (
                <button
                  key={`${row}:${col}`}
                  className={hinted ? 'cell hinted' : 'cell'}
                  disabled={!interactive}
                  onClick={() => onReveal(row, col)}
                  aria-label={`${where}, covered${hinted ? ', hinted' : ''}`}
                />
              );
            }

            // Spec: selected slots are marked bomb/empty and then disabled.
            const isBomb = cell.kind === 'bomb';
            return (
              <button
                key={`${row}:${col}`}
                className={`cell revealed ${isBomb ? 'bomb' : 'empty'}`}
                data-n={isBomb ? undefined : cell.adjacent}
                disabled
                aria-label={isBomb ? `${where}, mine` : `${where}, ${cell.adjacent} adjacent mines`}
              >
                {isBomb ? <MineSprite /> : cell.adjacent > 0 ? cell.adjacent : ''}
              </button>
            );
          }),
        ])}
      </div>
    </div>
  );
}
