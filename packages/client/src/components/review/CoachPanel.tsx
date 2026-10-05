import { COACH_QUESTION_MAX } from '@fmm/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { canAsk, questionsLeftText, type CoachChat } from '../../data/coachChat.js';
import { movesToShow } from '../../data/reviewModel.js';

interface Props {
  chat: CoachChat;
  asking: boolean;
  /** Why the last question was not sent (too long, empty), if it was not. */
  problem: string | null;
  /** The three suggested questions. */
  chips: string[];
  /** How many moves the game has, so "Show move N" only offers moves that exist. */
  totalMoves: number;
  /** No connection: the question box waits for one. */
  offline: boolean;
  onAsk: (question: string) => Promise<boolean>;
  onShowMove: (move: number) => void;
}

/**
 * The coach: a dark panel beside the board where the player asks about this
 * game. It answers from the game's own moves and odds, in a sentence or three,
 * and a move it names can be shown on the board with one click. Nothing said
 * here is saved; the line under the box says so, and how many questions are left.
 */
export function CoachPanel({ chat, asking, problem, chips, totalMoves, offline, onAsk, onShowMove }: Props) {
  const [input, setInput] = useState('');
  const log = useRef<HTMLDivElement>(null);

  // New bubbles scroll the conversation, not the page.
  useEffect(() => {
    const box = log.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chat.entries.length, asking]);

  const send = async (question: string) => {
    if (!canAsk(chat, question, asking, !offline)) return;
    const sent = await onAsk(question);
    if (sent) setInput((now) => (now === question ? '' : now));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const ready = !offline && !asking && (chat.left === null || chat.left > 0);

  return (
    <aside className="rv-coach" aria-label="Coach">
      <header className="rv-coach-head">
        <h3>
          COACH <span>&middot; answers from this game&rsquo;s moves and odds only</span>
        </h3>
      </header>

      <div className="rv-coach-log" ref={log} role="log" aria-live="polite" aria-label="Conversation with the coach">
        {chat.entries.length === 0 && (
          <p className="rv-coach-hint">Ask about a move, a mistake, or how to read the board. Try one of these:</p>
        )}
        {chat.entries.map((entry) => {
          const shows = entry.from === 'coach' && !entry.failed ? movesToShow(entry.text, totalMoves) : [];
          return (
            <div key={entry.id} className={`rv-bubble from-${entry.from}${entry.failed ? ' failed' : ''}`}>
              <p>{entry.text}</p>
              {shows.length > 0 && (
                <p className="rv-bubble-links">
                  {shows.map((move) => (
                    <button key={move} type="button" className="rv-link" onClick={() => onShowMove(move)}>
                      Show move {move}
                    </button>
                  ))}
                </p>
              )}
            </div>
          );
        })}
        {asking && (
          <div className="rv-bubble from-coach pending" role="status">
            <p>Looking at the moves…</p>
          </div>
        )}
      </div>

      <div className="rv-chips" role="group" aria-label="Suggested questions">
        {chips.map((chip) => (
          <button key={chip} type="button" className="rv-chip-ask" disabled={!ready} onClick={() => void send(chip)}>
            {chip}
          </button>
        ))}
      </div>

      <form className="rv-coach-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="rv-coach-input">
          Ask the coach a question about this game
        </label>
        <input
          id="rv-coach-input"
          type="text"
          value={input}
          maxLength={COACH_QUESTION_MAX}
          placeholder={offline ? 'Reconnecting…' : 'Ask about this game'}
          autoComplete="off"
          disabled={offline || (chat.left !== null && chat.left <= 0)}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={!canAsk(chat, input, asking, !offline)}>
          Ask
        </button>
      </form>
      {problem && (
        <p className="rv-coach-problem" role="alert">
          {problem}
        </p>
      )}

      <p className="rv-coach-foot">
        {questionsLeftText(chat.left)} · Powered by Groq · Can be wrong: the board is the record · Not saved
      </p>
    </aside>
  );
}
