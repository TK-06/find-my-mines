import type { ForfeitNotice, PublicMatchState, PuzzleStatus } from '@fmm/shared';
import { useEffect, useRef } from 'react';
import type { SoundSettings } from './settings.js';
import {
  FRESH_MEMORY,
  forfeitSoundEvents,
  puzzleSoundEvents,
  stepSounds,
  type SoundEvent,
  type SoundMemory,
} from './soundEvents.js';
import { soundFor } from './sounds.js';
import { armAudio, playSound } from './synth.js';
import { vibrate } from './vibration.js';

/** Plays what the events call for, as far as the player's two switches allow. */
function announce(events: readonly SoundEvent[], settings: SoundSettings): void {
  for (const event of events) {
    if (settings.sound) playSound(event.kind, soundFor(event));
    // Only your turn buzzes; every other cue is for the ears.
    if (settings.vibration && event.kind === 'myTurn') vibrate();
  }
}

/**
 * The game's sounds and the buzz when your turn starts.
 *
 * Watches the room's state as `useGame` hands it over, and plays what
 * changed *for this player*; the rules for that live in `soundEvents.ts`.
 * It decides nothing about the game. The first state after joining,
 * spectating or reconnecting is only remembered, never played back.
 */
export function useGameSounds(
  state: PublicMatchState | null,
  playerId: string | null,
  forfeit: ForfeitNotice | null,
  settings: SoundSettings,
): void {
  // Read when a sound is due, so flipping a switch needs no new effect.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Kept in refs, so React running an effect twice (StrictMode) cannot play
  // the same change twice: the second run finds nothing new.
  const memory = useRef<SoundMemory>(FRESH_MEMORY);
  /** A notice already on screen when this mounts is not announced. */
  const lastForfeit = useRef(forfeit);

  useEffect(() => armAudio(), []);

  useEffect(() => {
    const step = stepSounds(memory.current, state, playerId);
    memory.current = step.memory;
    announce(step.events, settingsRef.current);
  }, [state, playerId]);

  // A win by forfeit leaves the room waiting, not ended: only the notice says so.
  useEffect(() => {
    const events = forfeitSoundEvents(lastForfeit.current, forfeit, playerId);
    lastForfeit.current = forfeit;
    announce(events, settingsRef.current);
  }, [forfeit, playerId]);
}

/**
 * Puzzle mode's two sounds: the explosion when you open a mine, the fanfare
 * when you win. A game already over when the page opens stays quiet.
 */
export function usePuzzleSounds(status: PuzzleStatus, settings: SoundSettings): void {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const last = useRef(status);

  useEffect(() => armAudio(), []);

  useEffect(() => {
    const events = puzzleSoundEvents(last.current, status);
    last.current = status;
    announce(events, settingsRef.current);
  }, [status]);
}
