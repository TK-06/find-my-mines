import { isTooSoon, soundLength, startTime, type SoundDef, type Tone } from './sounds.js';

/**
 * The synthesiser: turns a `SoundDef` into Web Audio nodes and plays it.
 * No audio files — every sound is made here, from oscillators and noise.
 *
 * Browsers only let a page make noise after the person has touched it, so the
 * AudioContext is made lazily, on the first tap, click or key press. Until
 * then — and in a browser with no Web Audio — a sound is silently skipped.
 */

/** Overall volume. Kept low on purpose: these are cues, not music. */
const MASTER_GAIN = 0.2;

/** Takes the edge off the square waves, which are shrill on laptop speakers. */
const MASTER_LOWPASS_HZ = 5500;

/** Gains are ramped over these, never jumped, so no note clicks. */
const ATTACK_SECONDS = 0.006;
const RELEASE_SECONDS = 0.012;

/** A pulse wave's width: 25% is the thin, reedy voice of the old consoles. */
const PULSE_DUTY = 0.25;

/** The keys, taps and clicks that count as the person having touched the page. */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;
/** Everything plays into here: master volume, then the low-pass, then the speakers. */
let output: GainNode | null = null;
let pulseWave: PeriodicWave | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** When the sound that is playing now will finish, in the context's own clock. */
let busyUntil = 0;
/** When each kind of sound last started, to drop an exact repeat a few ms later. */
const lastStarted = new Map<string, number>();

let armed = false;

function audioConstructor(): AudioContextConstructor | null {
  const withPrefix = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? withPrefix.webkitAudioContext ?? null;
}

/**
 * A pulse wave has no built-in oscillator type, so it is built from its
 * harmonics: for a pulse of width d, harmonic n has cosine part
 * 2·sin(2πnd)/(πn) and sine part 2·(1 − cos(2πnd))/(πn).
 */
function makePulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  const harmonics = 64;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    real[n] = (2 * Math.sin(2 * Math.PI * n * duty)) / (Math.PI * n);
    imag[n] = (2 * (1 - Math.cos(2 * Math.PI * n * duty))) / (Math.PI * n);
  }
  return ctx.createPeriodicWave(real, imag);
}

/** A second of white noise, made once and reused by every explosion. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Makes the context and its output chain, once. Null when the browser has no Web Audio. */
function createContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioConstructor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = MASTER_LOWPASS_HZ;
    master.connect(lowpass).connect(ctx.destination);

    pulseWave = makePulseWave(ctx, PULSE_DUTY);
    noiseBuffer = makeNoise(ctx);
    output = master;
    context = ctx;
    return ctx;
  } catch {
    // Blocked or unsupported: the game plays on without sound.
    return null;
  }
}

/**
 * Starts listening for the first tap, click or key press, and makes the audio
 * context then. Safe to call again; it only ever arms once. The listeners go
 * as soon as the context is running — a press that does not count as a
 * gesture to the browser (some touches, some keys) leaves them for the next.
 */
export function armAudio(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;

  const disarm = () => {
    for (const gesture of GESTURES) window.removeEventListener(gesture, unlock, true);
  };
  const unlock = () => {
    const ctx = createContext();
    if (!ctx) {
      disarm();
      return;
    }
    // resume() must be called from inside the gesture, for Safari.
    void Promise.resolve(ctx.resume())
      .then(() => {
        if (ctx.state === 'running') disarm();
      })
      .catch(() => undefined);
  };
  for (const gesture of GESTURES) window.addEventListener(gesture, unlock, { capture: true, passive: true });
}

/** Ramps a note's gain up, lets it decay, and ends at zero: no jump, no click. */
function shapeEnvelope(gain: AudioParam, start: number, dur: number, peak: number): void {
  const attack = Math.min(ATTACK_SECONDS, dur / 4);
  gain.setValueAtTime(0, start);
  gain.linearRampToValueAtTime(peak, start + attack);
  gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 0.0001), start + dur);
  gain.linearRampToValueAtTime(0, start + dur + RELEASE_SECONDS);
}

function playTone(ctx: AudioContext, out: AudioNode, tone: Tone, soundStart: number, soundLevel: number): void {
  const start = soundStart + tone.at;
  const osc = ctx.createOscillator();
  if (tone.wave === 'pulse' && pulseWave) osc.setPeriodicWave(pulseWave);
  else osc.type = tone.wave === 'pulse' ? 'square' : tone.wave;
  osc.frequency.setValueAtTime(tone.freq, start);
  if (tone.glideTo) osc.frequency.exponentialRampToValueAtTime(tone.glideTo, start + tone.dur);

  const gain = ctx.createGain();
  shapeEnvelope(gain.gain, start, tone.dur, soundLevel * (tone.level ?? 1));
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + tone.dur + RELEASE_SECONDS + 0.02);
}

function playNoise(ctx: AudioContext, out: AudioNode, def: SoundDef, soundStart: number): void {
  const burst = def.noise;
  if (!burst || !noiseBuffer) return;
  const start = soundStart + burst.at;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  // The falling filter is what makes it a boom rather than a hiss.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(burst.from, start);
  filter.frequency.exponentialRampToValueAtTime(burst.to, start + burst.dur);

  const gain = ctx.createGain();
  shapeEnvelope(gain.gain, start, burst.dur, def.level * burst.level);
  source.connect(filter).connect(gain).connect(out);
  source.start(start);
  source.stop(start + burst.dur + RELEASE_SECONDS + 0.02);
}

/**
 * Plays a sound — or does nothing, quietly, when the page has not been touched
 * yet, the browser has no Web Audio, or the same sound just played.
 * `name` is what counts as "the same sound" for that last rule.
 */
export function playSound(name: string, def: SoundDef): void {
  const ctx = context;
  const out = output;
  if (!ctx || !out) return;
  if (ctx.state !== 'running') {
    // Suspended again (a phone locked, a tab put to sleep): wake it for the
    // next one rather than play this one late, out of step with the game.
    void Promise.resolve(ctx.resume()).catch(() => undefined);
    return;
  }

  const now = ctx.currentTime;
  if (isTooSoon(lastStarted.get(name), now)) return;
  lastStarted.set(name, now);

  // A hair of lead time, so the start is never already in the past.
  const start = startTime(now, busyUntil) + 0.01;
  busyUntil = Math.max(busyUntil, start + soundLength(def));

  for (const tone of def.tones) playTone(ctx, out, tone, start, def.level);
  playNoise(ctx, out, def, start);
}
