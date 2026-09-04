import type { PublicMatchState, RevealedCell } from '@fmm/shared';

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

export function Board({ state, myTurn, onReveal }: Props) {
  const revealed = revealMap(state.revealed);
  const interactive = myTurn && state.status === 'playing';

  return (
    <div className="board-wrap">
      <div
        className="board"
        style={{ gridTemplateColumns: `repeat(${state.cols}, auto)` }}
      >
        {Array.from({ length: state.rows }).flatMap((_, row) =>
          Array.from({ length: state.cols }).map((__, col) => {
            const cell = revealed.get(`${row}:${col}`);

            if (!cell) {
              return (
                <button
                  key={`${row}:${col}`}
                  className="cell"
                  disabled={!interactive}
                  onClick={() => onReveal(row, col)}
                  aria-label={`Row ${row + 1}, column ${col + 1}, covered`}
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
                aria-label={
                  isBomb
                    ? `Row ${row + 1}, column ${col + 1}, bomb`
                    : `Row ${row + 1}, column ${col + 1}, ${cell.adjacent} adjacent bombs`
                }
              >
                {isBomb ? '💣' : cell.adjacent > 0 ? cell.adjacent : ''}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
