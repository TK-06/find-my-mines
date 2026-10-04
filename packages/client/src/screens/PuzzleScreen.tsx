import { PUZZLE_HINTS_PER_GAME, PUZZLE_LEVELS, describePuzzleHint, puzzleMinesLeft } from '@fmm/shared';
import { useCallback, useEffect, useReducer } from 'react';
import { PuzzleBoard } from '../components/puzzle/PuzzleBoard.js';
import { PuzzleClock } from '../components/puzzle/PuzzleClock.js';
import { PUZZLE_LEVEL_NAMES, minesLeftLabel, presetSummary, resultText } from '../components/puzzle/puzzleCopy.js';
import { hintButtonLabel } from '../data/aiPlay.js';
import {
  clockDigits,
  formatSeconds,
  loadBestTimes,
  puzzleReducer,
  saveBestTimes,
  startSession,
} from '../data/puzzleStore.js';
import { useSoundSettings } from '../sound/settings.js';
import { usePuzzleSounds } from '../sound/useGameSounds.js';

/** A fresh seed with every move; only the first click's is used, to lay the mines. */
const newSeed = () => Math.floor(Math.random() * 0x1_0000_0000);

/**
 * Puzzle mode: classic single-player Minesweeper with an optional AI hint.
 *
 * Everything runs in this browser — the mines too, which is fine with no
 * opponent to hide them from. No socket, no sign-in and no Supabase: the page
 * works signed out and offline, and multiplayer rules are never touched. Best
 * times stay in localStorage.
 */
export function PuzzleScreen() {
  const [session, dispatch] = useReducer(puzzleReducer, undefined, () => startSession('easy', loadBestTimes()));
  const { game } = session;

  // The explosion when a mine goes off, the fanfare on a win.
  usePuzzleSounds(game.status, useSoundSettings());

  // Saved only when a record is set, merged with what is stored, so another
  // tab's record is never overwritten by this one's older view.
  useEffect(() => {
    if (session.newBest) saveBestTimes(session.best);
  }, [session.newBest, session.best]);

  const play = useCallback(
    (row: number, col: number) => dispatch({ type: 'play', row, col, seed: newSeed(), now: Date.now() }),
    [],
  );
  const flag = useCallback((row: number, col: number) => dispatch({ type: 'flag', row, col }), []);

  const left = puzzleMinesLeft(game);
  const hintsLeft = PUZZLE_HINTS_PER_GAME - game.hintsUsed;
  // Not before the first click (it is always safe) and one hint on the board at a time.
  const canHint = game.status === 'playing' && session.hint === null && hintsLeft > 0;
  const result = resultText(session);

  return (
    <div className="stack puzzle-screen">
      <div className="lobby-head">
        <div>
          <h2 className="section-title">Puzzle</h2>
          <p className="muted">
            Classic Minesweeper, on your own. It runs in this browser — no sign-in, nothing sent anywhere.
          </p>
        </div>
      </div>

      <div className="puzzle-levels" role="group" aria-label="Difficulty">
        {PUZZLE_LEVELS.map((level) => {
          const current = level === session.level;
          return (
            <button
              key={level}
              type="button"
              className={current ? 'puzzle-level' : 'ghost puzzle-level'}
              aria-pressed={current}
              onClick={() => dispatch({ type: 'new', level })}
            >
              <span className="puzzle-level-name">{PUZZLE_LEVEL_NAMES[level]}</span>
              <span className="puzzle-level-note">{presetSummary(level)}</span>
            </button>
          );
        })}
      </div>

      <section className="card puzzle-card" aria-label={`${PUZZLE_LEVEL_NAMES[session.level]} game`}>
        <div className="puzzle-bar">
          <div className="puzzle-stat">
            <span className="puzzle-digits" aria-hidden="true">
              {clockDigits(left)}
            </span>
            <span className="puzzle-stat-label" aria-hidden="true">
              mines left
            </span>
            <span className="puzzle-sr">{minesLeftLabel(left)}</span>
          </div>

          <button type="button" className="puzzle-new" onClick={() => dispatch({ type: 'new', level: session.level })}>
            New game
          </button>

          <PuzzleClock startedAt={session.startedAt} endedAt={session.endedAt} />

          <div className="puzzle-hint-box">
            <button type="button" className="ghost puzzle-hint" disabled={!canHint} onClick={() => dispatch({ type: 'hint' })}>
              {hintButtonLabel(hintsLeft)}
            </button>
            {game.hintsUsed > 0 && <span className="tag">hinted</span>}
          </div>
        </div>

        {/* Always rendered, so a screen reader hears each hint as it arrives. */}
        <div role="status" aria-live="polite" className="puzzle-hint-status">
          {session.hint && (
            <p className="hint-note">
              <span className="hint-mark" aria-hidden="true" />
              <span>
                <strong>Hint</strong> · {describePuzzleHint(session.hint)}
              </span>
            </p>
          )}
        </div>

        {/* The 30-wide board scrolls sideways in here on a narrow screen; the page never does. */}
        <div className="puzzle-scroll">
          <PuzzleBoard game={game} hint={session.hint} onPlay={play} onFlag={flag} describedBy="puzzle-controls" />
        </div>

        <p role="status" aria-live="polite" className={`puzzle-result ${game.status}`}>
          {result}
        </p>

        <p id="puzzle-controls" className="muted puzzle-controls">
          Click to open a cell; right-click or long-press to flag one. Click a number whose mines are all flagged to
          open the cells around it. Keyboard: arrow keys move, Enter or Space opens, F flags.
        </p>
      </section>

      <section className="card puzzle-best" aria-labelledby="puzzle-best-title">
        <h3 id="puzzle-best-title">Best times</h3>
        <ul className="list">
          {PUZZLE_LEVELS.map((level) => {
            const best = session.best[level];
            return (
              <li key={level}>
                <span>
                  <strong>{PUZZLE_LEVEL_NAMES[level]}</strong> <span className="muted">{presetSummary(level)}</span>
                </span>
                <span className="puzzle-best-time">{best === undefined ? '—' : formatSeconds(best)}</span>
              </li>
            );
          })}
        </ul>
        <p className="muted">Kept in this browser only. Games won with a hint don’t count.</p>
      </section>
    </div>
  );
}
