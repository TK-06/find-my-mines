import type { SoundEvent } from './soundEvents.js';

/**
 * Every sound, as plain data: a list of notes. Nothing here touches the Web
 * Audio API — `synth.ts` turns a `SoundDef` into oscillators — so a sound is
 * tuned by editing numbers, and the rules every sound must keep (short,
 * audible, in order) are tested.
 *
 * The voice is retro 8-bit: square, pulse and triangle waves with quick
 * envelopes. Each sound is well under a second, and quiet — `level` is how
 * loud it is next to the others, and the synth keeps the master volume low.
 */

/** The three voices: a hollow square, a thin bright pulse, and a soft triangle. */
export type Wave = 'square' | 'pulse' | 'triangle';

/** One note. Times are in seconds, counted from the start of the sound. */
export interface Tone {
  wave: Wave;
  /** Pitch in hertz. */
  freq: number;
  /** When it starts. */
  at: number;
  /** How long it sounds before dying away. */
  dur: number;
  /** Loudness against the rest of the sound, 0 to 1. Default 1. */
  level?: number;
  /** The pitch slides to this by the end of the note. */
  glideTo?: number;
}

/** A burst of noise whose filter sweeps down — the explosion. */
export interface NoiseBurst {
  at: number;
  dur: number;
  level: number;
  /** The low-pass filter starts here (Hz) and falls to `to`. */
  from: number;
  to: number;
}

export interface SoundDef {
  /** Loudness of the whole sound against the others, 0 to 1. */
  level: number;
  tones: readonly Tone[];
  noise?: NoiseBurst;
}

/** Pitches, in hertz, so the note lists below read as music. */
const C4 = 261.63;
const E4 = 329.63;
const G4 = 392.0;
const A4 = 440.0;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const B5 = 987.77;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;

/** The longest any sound may run — they are all short on purpose. */
export const MAX_SOUND_SECONDS = 0.9;

/** The same sound twice within this many seconds plays once. */
export const MIN_GAP_SECONDS = 0.06;

/** A sound that arrives while another plays waits for it, but never longer than this. */
export const MAX_QUEUE_SECONDS = 0.5;

/**
 * Your turn: two notes, rising — a chime. A thin pulse sparkles on the top one.
 */
const MY_TURN: SoundDef = {
  level: 0.8,
  tones: [
    { wave: 'triangle', freq: E5, at: 0, dur: 0.14 },
    { wave: 'triangle', freq: B5, at: 0.12, dur: 0.28 },
    { wave: 'pulse', freq: B5 * 2, at: 0.12, dur: 0.18, level: 0.18 },
  ],
};

/** Someone else's mine: the coin sound's idea, but lower, softer and rounder. */
const OTHER_MINE: SoundDef = {
  level: 0.4,
  tones: [
    { wave: 'triangle', freq: G4, at: 0, dur: 0.09 },
    { wave: 'triangle', freq: C5, at: 0.07, dur: 0.09 },
    { wave: 'triangle', freq: E5, at: 0.14, dur: 0.2 },
  ],
};

/** Your mine: a bright coin-style arpeggio, climbing fast. A reward. */
const MY_MINE: SoundDef = {
  level: 0.55,
  tones: [
    { wave: 'pulse', freq: G5, at: 0, dur: 0.07 },
    { wave: 'pulse', freq: C6, at: 0.055, dur: 0.07 },
    { wave: 'pulse', freq: E6, at: 0.11, dur: 0.07 },
    { wave: 'pulse', freq: G6, at: 0.165, dur: 0.2 },
  ],
};

/** Someone else's empty slot: a barely-there pip, so the board feels alive. */
const OTHER_EMPTY: SoundDef = {
  level: 0.25,
  tones: [{ wave: 'triangle', freq: G4, at: 0, dur: 0.03 }],
};

/** Your clock ran out: two notes, falling, the last one sagging. */
const TIMEOUT: SoundDef = {
  level: 0.6,
  tones: [
    { wave: 'triangle', freq: C5, at: 0, dur: 0.1 },
    { wave: 'triangle', freq: G4, at: 0.1, dur: 0.22, glideTo: 330 },
  ],
};

/** Winning: four notes up the chord, the last held, with the chord filled in under it. */
const WIN: SoundDef = {
  level: 0.6,
  tones: [
    { wave: 'pulse', freq: C5, at: 0, dur: 0.09 },
    { wave: 'pulse', freq: E5, at: 0.1, dur: 0.09 },
    { wave: 'pulse', freq: G5, at: 0.2, dur: 0.09 },
    { wave: 'pulse', freq: C6, at: 0.3, dur: 0.4 },
    { wave: 'triangle', freq: E5, at: 0.3, dur: 0.4, level: 0.5 },
    { wave: 'triangle', freq: G5, at: 0.3, dur: 0.4, level: 0.5 },
  ],
};

/** Losing: three notes stepping down, the last one sinking. */
const LOSE: SoundDef = {
  level: 0.65,
  tones: [
    { wave: 'triangle', freq: G4, at: 0, dur: 0.13 },
    { wave: 'triangle', freq: E4, at: 0.15, dur: 0.13 },
    { wave: 'triangle', freq: C4, at: 0.3, dur: 0.3, glideTo: 220 },
    { wave: 'pulse', freq: C4, at: 0.3, dur: 0.2, level: 0.15 },
  ],
};

/** A draw, or a spectator's end: two even notes, neither up nor down. */
const DRAW: SoundDef = {
  level: 0.55,
  tones: [
    { wave: 'triangle', freq: D5, at: 0, dur: 0.12 },
    { wave: 'triangle', freq: D5, at: 0.16, dur: 0.24 },
  ],
};

/** Puzzle, you opened a mine: noise through a filter that falls away. The only explosion. */
const EXPLOSION: SoundDef = {
  level: 0.5,
  tones: [],
  noise: { at: 0, dur: 0.55, level: 1, from: 2600, to: 80 },
};

/** The last three seconds each tick a little higher, so the pressure shows. */
const TICK_PITCH: Readonly<Record<number, number>> = { 3: E5, 2: G5, 1: B5 };

/** The pitch of the blip for a slot showing `adjacent` mines: a semitone up per mine, from A4. */
export function blipFrequency(adjacent: number): number {
  const steps = Number.isFinite(adjacent) ? Math.min(8, Math.max(0, Math.round(adjacent))) : 0;
  return A4 * 2 ** (steps / 12);
}

/** Your empty slot: a soft, short blip that rises a little with its number. */
function myEmpty(adjacent: number): SoundDef {
  return { level: 0.6, tones: [{ wave: 'triangle', freq: blipFrequency(adjacent), at: 0, dur: 0.07 }] };
}

/** One tick of the countdown: a short square pip. */
function tick(secondsLeft: number): SoundDef {
  const freq = TICK_PITCH[secondsLeft] ?? E5;
  return { level: 0.35, tones: [{ wave: 'square', freq, at: 0, dur: 0.05 }] };
}

/** The sound for an event. */
export function soundFor(event: SoundEvent): SoundDef {
  switch (event.kind) {
    case 'myTurn':
      return MY_TURN;
    case 'myEmpty':
      return myEmpty(event.adjacent);
    case 'myMine':
      return MY_MINE;
    case 'otherMine':
      return OTHER_MINE;
    case 'otherEmpty':
      return OTHER_EMPTY;
    case 'tick':
      return tick(event.secondsLeft);
    case 'timeout':
      return TIMEOUT;
    case 'win':
      return WIN;
    case 'lose':
      return LOSE;
    case 'draw':
      return DRAW;
    case 'explosion':
      return EXPLOSION;
  }
}

/** How long a sound runs, in seconds: until its last note or its noise has died away. */
export function soundLength(def: SoundDef): number {
  const ends = def.tones.map((tone) => tone.at + tone.dur);
  if (def.noise) ends.push(def.noise.at + def.noise.dur);
  return Math.max(0, ...ends);
}

/** Whether a sound is the same as one that played a moment ago and should be dropped. */
export function isTooSoon(lastAt: number | undefined, now: number, gap = MIN_GAP_SECONDS): boolean {
  return lastAt !== undefined && now - lastAt < gap;
}

/**
 * When a sound may start. Sounds that arrive together play one after another —
 * the last mine's coin, then the fanfare — instead of in a pile. But nothing
 * waits longer than `MAX_QUEUE_SECONDS`: past that it starts now, on top.
 */
export function startTime(now: number, busyUntil: number, maxWait = MAX_QUEUE_SECONDS): number {
  return busyUntil > now && busyUntil - now <= maxWait ? busyUntil : now;
}
