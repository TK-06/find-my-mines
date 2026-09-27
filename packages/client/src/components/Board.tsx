import { TURN_SECONDS, type PublicMatchState, type RevealedCell } from '@fmm/shared';
import type { CSSProperties } from 'react';

interface Props {
  state: PublicMatchState;
  /** True when this browser owns the current turn. */
  myTurn: boolean;
  onReveal: (row: number, col: number) => void;
}

/** Index the reveal history by cell for O(1) lookup while rendering. */
function revealMap(revealed: RevealedCell[]): Map<string, RevealedCell> {
  return new Map(revealed.map((cell) => [`${cell.row}:${cell.col}`, cell]));
}

/** Column letters, A–P for the largest 16-wide board. */
const colName = (col: number) => String.fromCharCode(65 + col);

/**
 * The board as a survey grid: lettered columns, numbered rows, and the turn
 * clock as a line along the top edge that drains while the turn runs.
 */
export function Board({ state, myTurn, onReveal }: Props) {
  const revealed = revealMap(state.revealed);
  const interactive = myTurn && state.status === 'playing';
  const playing = state.status === 'playing';
  const remaining = playing ? Math.max(0, state.secondsLeft) / TURN_SECONDS : 0;

  const style = { '--cols': state.cols } as CSSProperties;

  return (
    <div className={`board ${interactive ? 'my-turn' : ''}`} style={style}>
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

            if (!cell) {
              return (
                <button
                  key={`${row}:${col}`}
                  className="cell"
                  disabled={!interactive}
                  onClick={() => onReveal(row, col)}
                  aria-label={`${where}, covered`}
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
                {!isBomb && cell.adjacent > 0 ? cell.adjacent : ''}
              </button>
            );
          }),
        ])}
      </div>
    </div>
  );
}
