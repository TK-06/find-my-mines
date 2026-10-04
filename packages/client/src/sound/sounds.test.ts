import { describe, expect, it } from 'vitest';
import type { SoundEvent } from './soundEvents.js';
import {
  MAX_QUEUE_SECONDS,
  MAX_SOUND_SECONDS,
  MIN_GAP_SECONDS,
  blipFrequency,
  isTooSoon,
  soundFor,
  soundLength,
  startTime,
  type SoundDef,
} from './sounds.js';

/** Every event the game can ask for, with each countdown number and a spread of blips. */
const EVERY_EVENT: SoundEvent[] = [
  { kind: 'myTurn' },
  ...Array.from({ length: 9 }, (_, adjacent): SoundEvent => ({ kind: 'myEmpty', adjacent })),
  { kind: 'myMine' },
  { kind: 'otherMine' },
  { kind: 'otherEmpty' },
  { kind: 'tick', secondsLeft: 3 },
  { kind: 'tick', secondsLeft: 2 },
  { kind: 'tick', secondsLeft: 1 },
  { kind: 'timeout' },
  { kind: 'win' },
  { kind: 'lose' },
  { kind: 'draw' },
  { kind: 'explosion' },
];

const sound = (event: SoundEvent): SoundDef => soundFor(event);
const pitches = (def: SoundDef, wave?: string) =>
  def.tones.filter((t) => wave === undefined || t.wave === wave).map((t) => t.freq);

describe('every sound', () => {
  it('is short: well under a second', () => {
    for (const event of EVERY_EVENT) {
      const length = soundLength(sound(event));
      expect(length, event.kind).toBeGreaterThan(0);
      expect(length, event.kind).toBeLessThanOrEqual(MAX_SOUND_SECONDS);
    }
    expect(MAX_SOUND_SECONDS).toBeLessThan(1);
  });

  it('is quiet: its own level and every note’s sit inside 0 to 1, and nothing is silent', () => {
    for (const event of EVERY_EVENT) {
      const def = sound(event);
      expect(def.level, event.kind).toBeGreaterThan(0);
      expect(def.level, event.kind).toBeLessThanOrEqual(1);
      for (const tone of def.tones) {
        expect(tone.level ?? 1, event.kind).toBeGreaterThan(0);
        expect(tone.level ?? 1, event.kind).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has notes that are well-formed: audible pitch, real times, valid glide', () => {
    for (const event of EVERY_EVENT) {
      for (const tone of sound(event).tones) {
        expect(Number.isFinite(tone.freq), event.kind).toBe(true);
        expect(tone.freq, event.kind).toBeGreaterThan(100);
        expect(tone.freq, event.kind).toBeLessThan(5000);
        expect(tone.at, event.kind).toBeGreaterThanOrEqual(0);
        expect(tone.dur, event.kind).toBeGreaterThan(0.02);
        if (tone.glideTo !== undefined) expect(tone.glideTo, event.kind).toBeGreaterThan(0);
      }
    }
  });

  it('uses only the three retro voices', () => {
    for (const event of EVERY_EVENT) {
      for (const tone of sound(event).tones) expect(['square', 'pulse', 'triangle']).toContain(tone.wave);
    }
  });
});

describe('the blip for an empty slot', () => {
  it('rises with the slot’s number', () => {
    const freqs = Array.from({ length: 9 }, (_, n) => blipFrequency(n));
    for (let n = 1; n < freqs.length; n++) expect(freqs[n]!).toBeGreaterThan(freqs[n - 1]!);
  });

  it('rises only a little: under an octave from 0 to 8', () => {
    expect(blipFrequency(8) / blipFrequency(0)).toBeLessThan(2);
  });

  it('stays in range for anything it is handed', () => {
    expect(blipFrequency(-3)).toBe(blipFrequency(0));
    expect(blipFrequency(12)).toBe(blipFrequency(8));
    expect(blipFrequency(Number.NaN)).toBe(blipFrequency(0));
    expect(blipFrequency(2.4)).toBe(blipFrequency(2));
  });

  it('is what the event plays, one note, short and soft', () => {
    const def = sound({ kind: 'myEmpty', adjacent: 4 });
    expect(def.tones).toHaveLength(1);
    expect(def.tones[0]!.freq).toBe(blipFrequency(4));
    expect(def.tones[0]!.wave).toBe('triangle');
    expect(soundLength(def)).toBeLessThan(0.15);
  });
});

describe('how the sounds relate', () => {
  it('your mine is a bright arpeggio; theirs is the same idea, muted and lower', () => {
    const mine = sound({ kind: 'myMine' });
    const theirs = sound({ kind: 'otherMine' });
    expect(mine.tones.length).toBeGreaterThanOrEqual(3);
    expect(theirs.tones.length).toBeGreaterThanOrEqual(3);
    // An arpeggio climbs.
    for (const def of [mine, theirs]) {
      const freqs = pitches(def);
      expect(freqs).toEqual([...freqs].sort((a, b) => a - b));
    }
    expect(theirs.level).toBeLessThan(mine.level);
    expect(Math.max(...pitches(theirs))).toBeLessThan(Math.min(...pitches(mine)));
  });

  it('the other player’s empty slot is fainter than your own blip', () => {
    expect(sound({ kind: 'otherEmpty' }).level).toBeLessThan(sound({ kind: 'myEmpty', adjacent: 0 }).level);
  });

  it('your turn is two notes rising', () => {
    const [first, second, ...rest] = pitches(sound({ kind: 'myTurn' }), 'triangle');
    expect(rest).toEqual([]);
    expect(second!).toBeGreaterThan(first!);
  });

  it('the timeout is two notes falling', () => {
    const def = sound({ kind: 'timeout' });
    expect(def.tones).toHaveLength(2);
    expect(def.tones[1]!.freq).toBeLessThan(def.tones[0]!.freq);
  });

  it('the fanfare is four notes up, and the losing phrase is three notes down', () => {
    const win = pitches(sound({ kind: 'win' }), 'pulse');
    expect(win).toHaveLength(4);
    expect(win).toEqual([...win].sort((a, b) => a - b));

    const lose = pitches(sound({ kind: 'lose' }), 'triangle');
    expect(lose).toHaveLength(3);
    expect(lose).toEqual([...lose].sort((a, b) => b - a));
  });

  it('a draw is two even notes: neither up nor down', () => {
    const def = sound({ kind: 'draw' });
    expect(def.tones).toHaveLength(2);
    expect(def.tones[0]!.freq).toBe(def.tones[1]!.freq);
  });

  it('the countdown ticks get higher as the seconds run out', () => {
    const [three, two, one] = [3, 2, 1].map((secondsLeft) => sound({ kind: 'tick', secondsLeft }).tones[0]!.freq);
    expect(two!).toBeGreaterThan(three!);
    expect(one!).toBeGreaterThan(two!);
  });

  it('a tick is a tiny pip and a number outside 1 to 3 still has a sound', () => {
    const odd = sound({ kind: 'tick', secondsLeft: 9 });
    expect(odd.tones).toHaveLength(1);
    expect(soundLength(odd)).toBeLessThan(0.1);
  });

  it('the explosion is the only noise: no notes, a filter that falls', () => {
    for (const event of EVERY_EVENT) {
      const def = sound(event);
      if (event.kind === 'explosion') continue;
      expect(def.noise, event.kind).toBeUndefined();
    }
    const boom = sound({ kind: 'explosion' });
    expect(boom.tones).toEqual([]);
    expect(boom.noise).toBeDefined();
    expect(boom.noise!.to).toBeLessThan(boom.noise!.from);
    expect(boom.noise!.to).toBeGreaterThan(0);
  });
});

describe('soundLength', () => {
  it('runs to the end of the last note', () => {
    const def: SoundDef = {
      level: 1,
      tones: [
        { wave: 'square', freq: 440, at: 0, dur: 0.1 },
        { wave: 'square', freq: 440, at: 0.2, dur: 0.15 },
      ],
    };
    expect(soundLength(def)).toBeCloseTo(0.35);
  });

  it('counts a noise burst, and is zero for a sound with nothing in it', () => {
    expect(soundLength({ level: 1, tones: [], noise: { at: 0.1, dur: 0.4, level: 1, from: 1000, to: 100 } })).toBeCloseTo(0.5);
    expect(soundLength({ level: 1, tones: [] })).toBe(0);
  });
});

describe('isTooSoon', () => {
  it('drops the same sound a few milliseconds after it started', () => {
    expect(isTooSoon(1, 1.01)).toBe(true);
    expect(isTooSoon(1, 1 + MIN_GAP_SECONDS / 2)).toBe(true);
  });

  it('lets it through once the gap has passed, or the first time', () => {
    expect(isTooSoon(1, 1 + MIN_GAP_SECONDS)).toBe(false);
    expect(isTooSoon(1, 2)).toBe(false);
    expect(isTooSoon(undefined, 0)).toBe(false);
  });

  it('keeps the gap short enough that countdown ticks a second apart are never dropped', () => {
    expect(MIN_GAP_SECONDS).toBeLessThan(0.2);
    expect(isTooSoon(0, 1)).toBe(false);
  });
});

describe('startTime', () => {
  it('starts right away when nothing is playing', () => {
    expect(startTime(5, 0)).toBe(5);
    expect(startTime(5, 4.9)).toBe(5);
  });

  it('waits for the sound that is playing, so two sounds do not pile up', () => {
    expect(startTime(5, 5.3)).toBe(5.3);
  });

  it('never waits longer than the cap: past that it starts now, on top', () => {
    expect(startTime(5, 5 + MAX_QUEUE_SECONDS)).toBe(5 + MAX_QUEUE_SECONDS);
    expect(startTime(5, 5 + MAX_QUEUE_SECONDS + 0.01)).toBe(5);
  });
});
