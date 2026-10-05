import { cleanQuestion, type ReviewAskResult, type ReviewCoachResult, type ReviewRef } from '@fmm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { askedQuestion, coachRef, emptyChat, receivedAnswer, withLeft, type CoachChat } from './coachChat.js';

/** What the coach panel needs from the socket. `useGame` provides both. */
export interface CoachApi {
  status: (ref: ReviewRef) => Promise<ReviewCoachResult | null>;
  ask: (ref: ReviewRef, question: string) => Promise<ReviewAskResult | null>;
}

/**
 * Whether the coach can be asked: `checking` until the server says, `available`
 * when it has a key and knows the game, `unavailable` otherwise (and the panel
 * is then not shown at all). Without a connection there is no one to ask.
 */
export type CoachAvailability = 'checking' | 'available' | 'unavailable';

/**
 * The review coach's conversation for one game. The state lives with the page,
 * not the panel, so a panel that is hidden for a moment (a tab on the phone, a
 * dropped connection) keeps what was said. A new game starts a fresh chat; a
 * game just played that gets saved while the page is open (its match id arrives)
 * is still the same game, and keeps its chat.
 */
export function useCoach(
  game: { replayId?: string | null; matchId?: string | null } | null,
  api: CoachApi,
  connected: boolean,
) {
  const gameId = game?.replayId ?? game?.matchId ?? null;
  const [availability, setAvailability] = useState<CoachAvailability>('checking');
  const [chat, setChat] = useState<CoachChat>(emptyChat);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // What the latest render knows, for the async work below.
  const latest = useRef({ game, api });
  latest.current = { game, api };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Another game: another conversation.
  useEffect(() => {
    setChat(emptyChat());
    setProblem(null);
    setAsking(false);
    setAvailability('checking');
  }, [gameId]);

  // Ask the server whether the coach is on for this game, and how many
  // questions are left — again after a reconnect.
  useEffect(() => {
    const ref = coachRef(latest.current.game ?? {});
    if (!ref || !connected) {
      setAvailability('unavailable');
      return;
    }
    let live = true;
    void latest.current.api.status(ref).then((result) => {
      if (!live) return;
      if (result?.available) {
        setAvailability('available');
        setChat((chat) => withLeft(chat, result.questionsLeft));
      } else {
        setAvailability('unavailable');
      }
    });
    return () => {
      live = false;
    };
  }, [gameId, connected]);

  const ask = useCallback(async (question: string) => {
    const cleaned = cleanQuestion(question);
    if (!cleaned.ok) {
      setProblem(cleaned.error);
      return false;
    }
    const ref = coachRef(latest.current.game ?? {});
    if (!ref) return false;

    setProblem(null);
    setAsking(true);
    setChat((chat) => askedQuestion(chat, cleaned.text));
    const result = await latest.current.api.ask(ref, cleaned.text);
    if (!alive.current) return true;
    setChat((chat) => receivedAnswer(chat, result));
    setAsking(false);
    return true;
  }, []);

  return { availability, chat, asking, problem, ask };
}
