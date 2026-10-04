import { PUZZLE_HINTS_PER_GAME, PUZZLE_LEVELS, dailyKey, describePuzzleHint, puzzleMinesLeft } from '@fmm/shared';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { HintWithWhy } from '../components/HintWithWhy.js';
import { DailyPanel } from '../components/puzzle/DailyPanel.js';
import { PuzzleBoard } from '../components/puzzle/PuzzleBoard.js';
import { PuzzleClock } from '../components/puzzle/PuzzleClock.js';
import {
  PUZZLE_LEVEL_NAMES,
  dailyButtonLabel,
  dailyButtonNote,
  dailyLabel,
  dailyTodayText,
  daysText,
  minesLeftLabel,
  modeName,
  presetSummary,
  resultText,
} from '../components/puzzle/puzzleCopy.js';
import { useToday } from '../components/puzzle/useToday.js';
import { hintButtonLabel } from '../data/aiPlay.js';
import {
  clearSavedDaily,
  currentStreak,
  loadDailyRecords,
  loadSavedDaily,
  saveDailyRecords,
  saveSavedDaily,
} from '../data/dailyStore.js';
import {
  clockDigits,
  dailyProgress,
  formatMinutes,
  formatSeconds,
  loadBestTimes,
  openingSession,
  puzzleReducer,
  saveBestTimes,
} from '../data/puzzleStore.js';
import { useSoundSettings } from '../sound/settings.js';
import { usePuzzleSounds } from '../sound/useGameSounds.js';

/** A fresh seed with every move; only the first click's is used, to lay the mines. */
const newSeed = () => Math.floor(Math.random() * 0x1_0000_0000);

/**
 * Puzzle mode: classic single-player Minesweeper with an optional AI hint, and
 * a Daily challenge — the same board for everyone each Bangkok day.
 *
 * Everything runs in this browser — the mines too, which is fine with no
 * opponent to hide them from. No socket, no sign-in and no Supabase: the page
 * works signed out and offline, and multiplayer rules are never touched. Best
 * times, Daily results and an unfinished Daily game stay in localStorage.
 */
export function PuzzleScreen() {
  const [session, dispatch] = useReducer(puzzleReducer, undefined, () => {
    const today = dailyKey(Date.now());
    return openingSession(loadBestTimes(), loadDailyRecords(), loadSavedDaily(today), today);
  });
  const { game } = session;
  const today = useToday();

  // The explosion when a mine goes off, the fanfare on a win.
  usePuzzleSounds(game.status, useSoundSettings());

  // Saved only when a record is set, merged with what is stored, so another
  // tab's record is never overwritten by this one's older view.
  useEffect(() => {
    if (session.newBest) saveBestTimes(session.best);
  }, [session.newBest, session.best]);

  // The day's first try just ended: its result is kept, and the game that was
  // being saved for a reload is not needed any more.
  useEffect(() => {
    if (!session.recorded) return;
    saveDailyRecords(session.daily);
    clearSavedDaily();
  }, [session.recorded, session.daily]);

  // An unfinished first try is saved with every move, so a reload picks it up
  // where it was — with the clock still counting from the first click.
  // Only these parts of the session go into the save, so a hint appearing or
  // disappearing does not write again.
  const progress = useMemo(
    () => dailyProgress(session),
    [session.mode, session.practice, session.day, session.game, session.startedAt],
  );
  useEffect(() => {
    if (progress) saveSavedDaily(progress);
  }, [progress]);

  const play = useCallback(
    (row: number, col: number) => dispatch({ type: 'play', row, col, seed: newSeed(), now: Date.now() }),
    [],
  );
  const flag = useCallback((row: number, col: number) => dispatch({ type: 'flag', row, col }), []);
  // Storage is read now, at the click, rather than trusting what the page saw when it opened.
  const openDaily = () => {
    const key = dailyKey(Date.now());
    dispatch({ type: 'daily', key, records: loadDailyRecords(), saved: loadSavedDaily(key) });
  };

  const left = puzzleMinesLeft(game);
  const hintsLeft = PUZZLE_HINTS_PER_GAME - game.hintsUsed;
  // Not before the first click (it is always safe) and one hint on the board at a time.
  const canHint = game.status === 'playing' && session.hint === null && hintsLeft > 0;
  const result = resultText(session);

  const levelInPlay = session.mode === 'daily' ? null : session.mode;
  // The Daily's first try is not for restarting, so while it is open there is no new-game button at all.
  const firstTryOpen = session.mode === 'daily' && !session.practice && game.status === 'playing';
  const todaysResult = session.daily.days[today];
  const streak = currentStreak(session.daily.days, today);

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

      <div className="puzzle-levels" role="group" aria-label="Difficulty or Daily">
        {PUZZLE_LEVELS.map((level) => {
          const current = level === levelInPlay;
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
        {/* The same look as the levels. Its number and its note follow today's date and result. */}
        <button
          type="button"
          className={levelInPlay === null ? 'puzzle-level' : 'ghost puzzle-level'}
          aria-pressed={levelInPlay === null}
          aria-label={dailyButtonLabel(today, todaysResult)}
          onClick={openDaily}
        >
          <span className="puzzle-level-name">{dailyLabel(today)}</span>
          <span className="puzzle-level-note">{dailyButtonNote(todaysResult)}</span>
        </button>
      </div>

      <section className="card puzzle-card" aria-label={`${modeName(session)} game`}>
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

          {levelInPlay !== null ? (
            <button type="button" className="puzzle-new" onClick={() => dispatch({ type: 'new', level: levelInPlay })}>
              New game
            </button>
          ) : (
            !firstTryOpen && (
              <button type="button" className="puzzle-new" onClick={() => dispatch({ type: 'practice' })}>
                Play again (practice)
              </button>
            )
          )}

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
          {/* Keyed by how many hints this game has used: each new hint starts with its Why? closed. */}
          {session.hint && (
            <HintWithWhy
              key={game.hintsUsed}
              label="Hint"
              text={describePuzzleHint(session.hint)}
              why={session.why?.text}
            />
          )}
        </div>

        {session.day !== null && (
          <DailyPanel
            day={session.day}
            today={today}
            result={session.daily.days[session.day]}
            streak={streak}
            bestStreak={session.daily.bestStreak}
          />
        )}

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

        <h4 className="puzzle-best-sub" id="puzzle-daily-title">
          Daily
        </h4>
        <ul className="list" aria-labelledby="puzzle-daily-title">
          <li>
            <span>
              <strong>{dailyLabel(today)}</strong> <span className="muted">today</span>
            </span>
            <span className="puzzle-best-time">{dailyTodayText(todaysResult)}</span>
          </li>
          <li>
            <span>Current streak</span>
            <span className="puzzle-best-time">{daysText(streak)}</span>
          </li>
          <li>
            <span>Best streak</span>
            <span className="puzzle-best-time">{daysText(session.daily.bestStreak)}</span>
          </li>
          <li>
            <span>Best Daily time</span>
            <span className="puzzle-best-time">
              {session.daily.bestTime === null ? '—' : formatMinutes(session.daily.bestTime)}
            </span>
          </li>
          <li>
            <span>Dailies played</span>
            <span className="puzzle-best-time">{session.daily.played}</span>
          </li>
        </ul>

        <p className="muted">
          Kept in this browser only. Games won with a hint don’t count. On the Daily only your first try each day counts —
          the best Daily time is your fastest first-try win with no hints.
        </p>
      </section>
    </div>
  );
}
