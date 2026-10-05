import { TURN_SECONDS, type MinePosition, type PublicMatchState, type RevealedCell } from '@fmm/shared';
import type { CSSProperties } from 'react';
import { normalizeFlyScores } from './fly/smellMap.js';
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
   * The Fruit Fly's "smell map" for its current move: the candidates it chose
   * between, with its readout scores. Public-board cells only, shown until it
   * reveals. Null for every other room.
   */
  flyScores?: { row: number; col: number; score: number }[] | null;
  /** The cell the fly picked, ringed on the board while the map shows. */
  flyPick?: { row: number; col: number } | null;
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
export function Board({ state, myTurn, onReveal, mines, hint, flyScores, flyPick }: Props) {
  const revealed = revealMap(state.revealed);
  const hiddenMines = new Set((mines ?? []).map((m) => `${m.row}:${m.col}`));
  const interactive = myTurn && state.status === 'playing';
  const playing = state.status === 'playing';
  const remaining = playing ? Math.max(0, state.secondsLeft) / TURN_SECONDS : 0;

  // The fly's candidate scores, minimal-maximal, for the covered cells it looked at.
  const flyScoresByCell = new Map<string, number>();
  if (flyScores && flyScores.length > 0) {
    const normalized = normalizeFlyScores(flyScores.map((cell) => cell.score));
    flyScores.forEach((cell, index) =>
      flyScoresByCell.set(`${cell.row}:${cell.col}`, normalized[index]!),
    );
  }

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
              const fly = flyScoresByCell.get(`${row}:${col}`);
              const classes = ['cell'];
              if (hinted) classes.push('hinted');
              if (fly !== undefined) classes.push('fly-scored');
              if (fly !== undefined && flyPick?.row === row && flyPick.col === col) classes.push('fly-pick');
              return (
                <button
                  key={`${row}:${col}`}
                  className={classes.join(' ')}
                  disabled={!interactive}
                  onClick={() => onReveal(row, col)}
                  aria-label={`${where}, covered${hinted ? ', hinted' : ''}`}
                  style={fly !== undefined ? ({ '--fly': fly } as CSSProperties) : undefined}
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
