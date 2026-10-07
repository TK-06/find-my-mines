import { RATINGS, type Review } from '@fmm/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CoachPanel } from '../components/review/CoachPanel.js';
import { KeyMoments } from '../components/review/KeyMoments.js';
import { MoveList } from '../components/review/MoveList.js';
import { MoveTimeline } from '../components/review/MoveTimeline.js';
import { RatingChip } from '../components/review/RatingChip.js';
import { ReviewBoard, type ReviewFilters } from '../components/review/ReviewBoard.js';
import { SeatCards } from '../components/review/SeatCards.js';
import type { LatestReplay } from '../data/latestReplay.js';
import { formatDay } from '../data/profileStats.js';
import {
  boardLine,
  coachChips,
  moveCounter,
  moveDetail,
  moveHeadline,
  scoreBeforeLabel,
  seatTones,
} from '../data/reviewModel.js';
import { useCoach, type CoachApi } from '../data/useCoach.js';
import { useReview } from '../data/useReview.js';
import { useReviewSource, type ReviewSource } from '../data/useReviewSource.js';
import { canGoBackHere, isPlainLeftClick, pathFor, type ReviewTarget, type Route } from '../router.js';

interface Props {
  target: ReviewTarget;
  /** The game this tab last finished, from memory: what `/review/latest` shows. */
  latest: LatestReplay | null;
  connected: boolean;
  coachApi: CoachApi;
  onNavigate: (next: Route) => void;
}

/**
 * A finished game, move by move: the board at each move with the chance of every
 * covered slot, where the mines were and the best pick; how well each move was
 * chosen; the moments that mattered; and a coach to ask about it.
 *
 * It reads its game from this tab's memory (`/review/latest`, which needs no
 * database) or from the saved match (`/review/<id>`). Everything is worked out
 * in the browser from the replay: the board at each move is drawn from the moves
 * before it, and the odds come from the public view at that point, never from
 * where the mines were.
 */
export function ReviewScreen({ target, latest, connected, coachApi, onNavigate }: Props) {
  const state = useReviewSource(target, latest);
  // The game just played goes back to the game. A saved game can be opened from
  // many places — your profile, someone else's, the console's game log, a link a
  // friend sent — and there is no list of games of its own to return to, so it
  // steps back to wherever it was opened from. Only when there is no such place on
  // this site (a link opened in a new tab, a bookmark) does it fall back to Play.
  const stepBack = target !== 'latest' && canGoBackHere();
  const back = (
    <a
      href={pathFor('game')}
      className="rv-back"
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        if (stepBack) window.history.back();
        else onNavigate('game');
      }}
    >
      {stepBack ? '← Back' : '← Back to the game'}
    </a>
  );

  if (state.status === 'ready') {
    // Another game, another page: the selected move and the filters start over.
    return (
      <ReviewBody
        key={`${state.source.game.replayId ?? ''}|${target}`}
        source={state.source}
        back={back}
        connected={connected}
        coachApi={coachApi}
      />
    );
  }

  return (
    <div className="stack review">
      <div className="rv-head">
        {back}
        <p className="rv-kicker">GAME REVIEW</p>
      </div>
      <div className="card empty-state" role={state.status === 'loading' ? 'status' : undefined}>
        {state.status === 'loading' && <p className="muted">Loading the game…</p>}
        {state.status === 'no-latest' && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>No game to review yet</p>
            <p className="muted">Finish a game and its review opens from the result screen, or from Review on your profile.</p>
          </>
        )}
        {state.status === 'none' && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>No replay saved for this game</p>
            <p className="muted">Only games finished since replays were added can be reviewed.</p>
          </>
        )}
        {state.status === 'off' && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>Saved games are off</p>
            <p className="muted">No Supabase configuration was found, so there are no saved games to open.</p>
          </>
        )}
        {state.status === 'error' && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>Couldn’t load this game</p>
            <p className="muted">Check your connection and open the review again.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** One word for the mode, as the match cards tag it. */
const MODE_TAG = { casual: 'casual', ranked: 'ranked' } as const;

function ReviewBody({
  source,
  back,
  connected,
  coachApi,
}: {
  source: ReviewSource;
  back: React.ReactNode;
  connected: boolean;
  coachApi: CoachApi;
}) {
  const { replay, you } = source;
  const status = useReview(replay);
  const names = useMemo(() => replay.seats.map((seat) => seat.name), [replay]);
  const tones = useMemo(() => seatTones(replay.seats.length, you), [replay, you]);

  const [move, setMove] = useState(1);
  const [filters, setFilters] = useState<ReviewFilters>({ odds: true, mines: false, best: true });
  const [tab, setTab] = useState<'moves' | 'coach'>('moves');
  const replayCard = useRef<HTMLElement>(null);

  const coach = useCoach(source.game, coachApi, connected);
  // For a game just played the server has already said the coach is on, so its
  // panel holds its place while it checks; a saved game shows it once confirmed.
  const showCoach = coach.availability === 'available' || (coach.availability === 'checking' && source.coachHint === true);

  const toggle = (name: keyof ReviewFilters) => setFilters((now) => ({ ...now, [name]: !now[name] }));

  /** Jump to a move and bring the board into view (a card or a link elsewhere on the page asked for it). */
  const jump = useCallback((to: number) => {
    setMove(to);
    replayCard.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const opponents = names.filter((_, seat) => seat !== you);
  const versus = you === null ? names.join(' vs ') : `vs ${opponents.join(', ')}`;

  const head = (
    <div className="rv-head">
      {back}
      <p className="rv-kicker">GAME REVIEW</p>
      <h2 className="rv-title">
        {boardLine(replay)}
        {source.mode && <span className={`tag mode-${source.mode}`}>{MODE_TAG[source.mode]}</span>}
        <span className="rv-title-rest">
          {versus}
          {source.when && ` · ${formatDay(source.when)}`}
        </span>
      </h2>
    </div>
  );

  if (status.phase !== 'ready') {
    return (
      <div className="stack review">
        {head}
        {status.phase === 'failed' ? (
          <div className="card empty-state" role="alert">
            <p style={{ margin: 0, fontWeight: 600 }}>Couldn’t analyse this game</p>
            <p className="muted">Open the review again to retry.</p>
          </div>
        ) : (
          <div className="card rv-progress" role="status" aria-live="polite">
            <p style={{ margin: 0, fontWeight: 600 }}>Analysing the game…</p>
            <p className="muted" style={{ margin: '2px 0 10px' }}>
              {status.phase === 'running' ? `move ${status.done} of ${status.total}` : 'starting'}
            </p>
            <progress
              max={status.phase === 'running' ? Math.max(1, status.total) : 1}
              value={status.phase === 'running' ? status.done : 0}
              aria-label="Analysis progress"
            />
          </div>
        )}
      </div>
    );
  }

  const review: Review = status.review;
  const total = review.moves.length;

  if (total === 0) {
    return (
      <div className="stack review">
        {head}
        <SeatCards review={review} you={you} tones={tones} />
        <div className="card empty-state">
          <p style={{ margin: 0, fontWeight: 600 }}>Nobody opened a slot</p>
          <p className="muted">There are no moves to step through in this game.</p>
        </div>
      </div>
    );
  }

  const current = review.moves[move - 1]!;

  return (
    <div className="stack review">
      {head}
      <SeatCards review={review} you={you} tones={tones} />
      {!review.complete && (
        <p className="muted rv-early">
          This game ended early because a player left, so the moves alone do not say who won.
        </p>
      )}
      <KeyMoments moments={review.moments} names={names} you={you} onJump={jump} />

      <div className={`rv-main${showCoach ? ' with-coach' : ''}`}>
        <div className="rv-left">
          <section className="rv-replay" ref={replayCard} aria-label="Replay">
            <div className="rv-filters" role="group" aria-label="Show on the board">
              <button type="button" className={`rv-filter${filters.odds ? ' on' : ''}`} aria-pressed={filters.odds} onClick={() => toggle('odds')}>
                % Odds
              </button>
              <button type="button" className={`rv-filter${filters.mines ? ' on' : ''}`} aria-pressed={filters.mines} onClick={() => toggle('mines')}>
                Mines
              </button>
              <button type="button" className={`rv-filter${filters.best ? ' on' : ''}`} aria-pressed={filters.best} onClick={() => toggle('best')}>
                Best pick
              </button>
            </div>

            <div className="rv-stage">
              <div className="rv-board-col">
                <p className="rv-score">
                  <span className="muted">Score before move {move}</span> {scoreBeforeLabel(current, names, you)}
                </p>
                <div className="rv-board-scroll">
                  <ReviewBoard replay={replay} review={review} move={move} filters={filters} tones={tones} names={names} onStep={setMove} />
                </div>
              </div>

              <div className="rv-info" aria-live="polite">
                <p className="rv-counter">{moveCounter(move, total)}</p>
                <RatingChip rating={current.rating} />
                <p className="rv-headline">{moveHeadline(current, names, you)}</p>
                <p className="rv-detail">{moveDetail(current)}</p>
                <Legend filters={filters} you={you} />
              </div>
            </div>

            <div className="rv-nav">
              <button type="button" className="ghost rv-step" disabled={move <= 1} onClick={() => setMove(move - 1)} aria-label="Previous move">
                ‹
              </button>
              <MoveTimeline moves={review.moves} current={move} names={names} you={you} onSelect={setMove} />
              <button type="button" className="ghost rv-step" disabled={move >= total} onClick={() => setMove(move + 1)} aria-label="Next move">
                ›
              </button>
            </div>
            <ul className="rv-rating-key" aria-label="Rating colours">
              {RATINGS.map((rating) => (
                <li key={rating}>
                  <RatingChip rating={rating} />
                </li>
              ))}
            </ul>
          </section>

          {showCoach && (
            <div className="rv-tabs" role="tablist" aria-label="Moves and coach">
              <button type="button" role="tab" aria-selected={tab === 'moves'} className={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')}>
                Moves
              </button>
              <button type="button" role="tab" aria-selected={tab === 'coach'} className={tab === 'coach' ? 'on' : ''} onClick={() => setTab('coach')}>
                Coach
              </button>
            </div>
          )}

          <section className={`rv-moves${showCoach && tab !== 'moves' ? ' tab-hidden' : ''}`} aria-label="Moves">
            <MoveList moves={review.moves} current={move} names={names} you={you} tones={tones} onSelect={setMove} />
          </section>
        </div>

        {showCoach && (
          <div className={`rv-coach-wrap${tab !== 'coach' ? ' tab-hidden' : ''}`}>
            <CoachPanel
              chat={coach.chat}
              asking={coach.asking}
              problem={coach.problem}
              chips={coachChips(review)}
              totalMoves={total}
              offline={!connected}
              onAsk={coach.ask}
              onShowMove={jump}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** What the colours and marks on the board mean, for the switches that are on. */
function Legend({ filters, you }: { filters: ReviewFilters; you: number | null }) {
  return (
    <ul className="rv-legend" aria-label="Legend">
      <li>
        <i className="lg open" aria-hidden="true">
          2
        </i>
        open number
      </li>
      {you !== null && (
        <li>
          <i className="lg found tone-you" aria-hidden="true" />
          your mine
        </li>
      )}
      <li>
        <i className="lg found tone-p0" aria-hidden="true" />
        {you === null ? 'found mine' : 'their mine'}
      </li>
      {filters.odds && (
        <li>
          <i className="lg odds" aria-hidden="true" />
          chance of a mine
        </li>
      )}
      {filters.mines && (
        <li>
          <i className="lg minemark" aria-hidden="true" />
          hidden mine
        </li>
      )}
      {filters.best && (
        <li>
          <i className="lg star" aria-hidden="true">
            ★
          </i>
          best pick
        </li>
      )}
      <li>
        <i className="lg ring" aria-hidden="true" />
        slot opened
      </li>
    </ul>
  );
}
