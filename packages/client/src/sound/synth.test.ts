import { afterEach, describe, expect, it, vi } from 'vitest';
import { soundFor, soundLength } from './sounds.js';

/**
 * The synth talks to the Web Audio API, which Node does not have, so these
 * run it against a stand-in that records what it was asked to do. They check
 * the promises the synth makes — silent before a tap, no clicks, no pile-ups —
 * not how the sounds actually sound; that wants ears.
 */

type Call = { kind: 'set' | 'linear' | 'exp'; value: number; time: number };

class FakeParam {
  calls: Call[] = [];
  value = 0;
  setValueAtTime(value: number, time: number) {
    this.calls.push({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ kind: 'linear', value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push({ kind: 'exp', value, time });
  }
}

class FakeNode {
  connected: unknown[] = [];
  connect<T>(next: T): T {
    this.connected.push(next);
    return next;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  periodicWave: unknown = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  setPeriodicWave(wave: unknown) {
    this.periodicWave = wave;
  }
  start(time: number) {
    this.startedAt = time;
  }
  stop(time: number) {
    this.stoppedAt = time;
  }
}

class FakeFilter extends FakeNode {
  type = 'allpass';
  frequency = new FakeParam();
  Q = { value: 1 };
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  startedAt: number | null = null;
  start(time: number) {
    this.startedAt = time;
  }
  stop() {}
}

class FakeContext {
  static made: FakeContext[] = [];
  static initialState: 'running' | 'suspended' = 'running';
  /** False for a browser that does not count the tap, so resume() leaves the context asleep. */
  static resumeWorks = true;

  currentTime = 10;
  sampleRate = 8000;
  state: string = FakeContext.initialState;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  filters: FakeFilter[] = [];
  sources: FakeSource[] = [];
  resume = vi.fn(async () => {
    if (FakeContext.resumeWorks) this.state = 'running';
  });

  constructor() {
    FakeContext.made.push(this);
  }
  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array) {
    return { real, imag };
  }
}

/** A window that only keeps track of listeners, so a test can fire a "tap". */
function fakeWindow(audio: unknown) {
  const handlers = new Map<string, Set<() => void>>();
  return {
    AudioContext: audio,
    addEventListener: (name: string, handler: () => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(handler);
    },
    removeEventListener: (name: string, handler: () => void) => {
      handlers.get(name)?.delete(handler);
    },
    listenerCount: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
    fire: (name: string) => {
      for (const handler of [...(handlers.get(name) ?? [])]) handler();
    },
  };
}

/** Loads a fresh copy of the synth, since it keeps its context in module state. */
async function load(audio: unknown = FakeContext) {
  vi.resetModules();
  FakeContext.made = [];
  const win = fakeWindow(audio);
  vi.stubGlobal('window', win);
  const synth = await import('./synth.js');
  return { synth, win };
}

/** Lets the promise inside the first tap settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const ctxOf = () => FakeContext.made[0]!;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeContext.initialState = 'running';
  FakeContext.resumeWorks = true;
});

describe('before the page has been touched', () => {
  it('makes no sound and no audio context, whatever it is asked to play', async () => {
    const { synth } = await load();
    synth.armAudio();
    synth.playSound('myMine', soundFor({ kind: 'myMine' }));
    expect(FakeContext.made).toHaveLength(0);
  });

  it('listens for taps, clicks and keys, once however often it is armed', async () => {
    const { synth, win } = await load();
    synth.armAudio();
    const once = win.listenerCount();
    synth.armAudio();
    expect(once).toBeGreaterThan(0);
    expect(win.listenerCount()).toBe(once);
  });
});

describe('the first tap', () => {
  it('makes the audio context, once, and stops listening when it is running', async () => {
    const { synth, win } = await load();
    synth.armAudio();
    win.fire('pointerdown');
    await settle();
    expect(FakeContext.made).toHaveLength(1);
    expect(ctxOf().resume).toHaveBeenCalled();
    expect(win.listenerCount()).toBe(0);
    win.fire('keydown');
    expect(FakeContext.made).toHaveLength(1);
  });

  it('sets the master volume low, behind a low-pass', async () => {
    const { synth, win } = await load();
    synth.armAudio();
    win.fire('click');
    await settle();
    const master = ctxOf().gains[0]!;
    expect(master.gain.value).toBeGreaterThan(0);
    expect(master.gain.value).toBeLessThanOrEqual(0.3);
    expect(ctxOf().filters[0]!.type).toBe('lowpass');
  });

  it('keeps listening when the browser did not count the tap (the context stays suspended)', async () => {
    FakeContext.initialState = 'suspended';
    FakeContext.resumeWorks = false;
    const { synth, win } = await load();
    synth.armAudio();
    win.fire('pointerdown');
    await settle();
    // resume() came back, but the page is still not allowed to play: wait for a better tap.
    expect(ctxOf().state).toBe('suspended');
    expect(win.listenerCount()).toBeGreaterThan(0);
  });

  it('stays quiet, and does not crash, in a browser with no Web Audio', async () => {
    const { synth, win } = await load(null);
    synth.armAudio();
    expect(() => win.fire('pointerdown')).not.toThrow();
    expect(() => synth.playSound('win', soundFor({ kind: 'win' }))).not.toThrow();
    expect(win.listenerCount()).toBe(0);
  });

  it('stays quiet when making the context throws (blocked)', async () => {
    class Blocked {
      constructor() {
        throw new Error('not allowed');
      }
    }
    const { synth, win } = await load(Blocked);
    synth.armAudio();
    expect(() => win.fire('pointerdown')).not.toThrow();
    expect(() => synth.playSound('win', soundFor({ kind: 'win' }))).not.toThrow();
  });
});

/** The audio context after one tap, ready to play. */
async function unlocked() {
  const loaded = await load();
  loaded.synth.armAudio();
  loaded.win.fire('pointerdown');
  await settle();
  return { ...loaded, ctx: ctxOf() };
}

describe('playing a sound', () => {
  it('starts one oscillator per note, at the right pitch and time', async () => {
    const { synth, ctx } = await unlocked();
    const def = soundFor({ kind: 'myMine' });
    synth.playSound('myMine', def);
    expect(ctx.oscillators).toHaveLength(def.tones.length);
    ctx.oscillators.forEach((osc, i) => {
      expect(osc.frequency.calls[0]).toMatchObject({ kind: 'set', value: def.tones[i]!.freq });
      expect(osc.startedAt).toBeGreaterThanOrEqual(ctx.currentTime);
      expect(osc.stoppedAt!).toBeGreaterThan(osc.startedAt!);
    });
    // Notes start in order, as the data says.
    const starts = ctx.oscillators.map((osc) => osc.startedAt!);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('gives the pulse notes a pulse wave, and the others a built-in one', async () => {
    const { synth, ctx } = await unlocked();
    synth.playSound('win', soundFor({ kind: 'win' }));
    const types = ctx.oscillators.map((osc) => (osc.periodicWave ? 'pulse' : osc.type));
    expect(types).toContain('pulse');
    expect(types).toContain('triangle');
  });

  it('never jumps a gain: every note ramps up from zero and ramps back down to zero', async () => {
    const { synth, ctx } = await unlocked();
    synth.playSound('myTurn', soundFor({ kind: 'myTurn' }));
    // gains[0] is the master; the rest belong to notes.
    const noteGains = ctx.gains.slice(1);
    expect(noteGains.length).toBeGreaterThan(0);
    for (const node of noteGains) {
      const calls = node.gain.calls;
      expect(calls[0]).toMatchObject({ kind: 'set', value: 0 });
      expect(calls.filter((c) => c.kind === 'set')).toHaveLength(1);
      expect(calls[calls.length - 1]).toMatchObject({ kind: 'linear', value: 0 });
      const times = calls.map((c) => c.time);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      // The attack takes real time, so the first ramp is not a click.
      expect(calls[1]!.time - calls[0]!.time).toBeGreaterThan(0.001);
      // And nothing ever asks for a gain above the sound's own level.
      for (const c of calls) expect(c.value).toBeLessThanOrEqual(1);
    }
  });

  it('never ramps toward zero exactly, which an exponential ramp cannot do', async () => {
    const { synth, ctx } = await unlocked();
    synth.playSound('win', soundFor({ kind: 'win' }));
    for (const node of ctx.gains.slice(1)) {
      for (const c of node.gain.calls.filter((call) => call.kind === 'exp')) expect(c.value).toBeGreaterThan(0);
    }
  });

  it('slides a note’s pitch when the sound says so', async () => {
    const { synth, ctx } = await unlocked();
    synth.playSound('timeout', soundFor({ kind: 'timeout' }));
    const sliding = ctx.oscillators.find((osc) => osc.frequency.calls.some((c) => c.kind === 'exp'));
    expect(sliding).toBeDefined();
  });

  it('makes the explosion from noise through a low-pass filter that falls', async () => {
    const { synth, ctx } = await unlocked();
    const def = soundFor({ kind: 'explosion' });
    synth.playSound('explosion', def);
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.sources).toHaveLength(1);
    // filters[0] is the master low-pass; the explosion's own comes after it.
    const filter = ctx.filters[1]!;
    expect(filter.type).toBe('lowpass');
    const [from, to] = filter.frequency.calls;
    expect(from!.value).toBe(def.noise!.from);
    expect(to!.value).toBe(def.noise!.to);
    expect(to!.time).toBeGreaterThan(from!.time);
  });
});

describe('not piling sounds up', () => {
  it('drops the same sound asked for again a few milliseconds later', async () => {
    const { synth, ctx } = await unlocked();
    const def = soundFor({ kind: 'otherMine' });
    synth.playSound('otherMine', def);
    ctx.currentTime += 0.01;
    synth.playSound('otherMine', def);
    expect(ctx.oscillators).toHaveLength(def.tones.length);
  });

  it('plays it again once the gap has passed', async () => {
    const { synth, ctx } = await unlocked();
    const def = soundFor({ kind: 'tick', secondsLeft: 3 });
    synth.playSound('tick', def);
    ctx.currentTime += 1;
    synth.playSound('tick', def);
    expect(ctx.oscillators).toHaveLength(def.tones.length * 2);
  });

  it('lets a different sound through at once', async () => {
    const { synth, ctx } = await unlocked();
    synth.playSound('myMine', soundFor({ kind: 'myMine' }));
    ctx.currentTime += 0.01;
    synth.playSound('win', soundFor({ kind: 'win' }));
    expect(ctx.oscillators.length).toBe(soundFor({ kind: 'myMine' }).tones.length + soundFor({ kind: 'win' }).tones.length);
  });

  it('puts a second sound after the first when they arrive together: the last coin, then the fanfare', async () => {
    const { synth, ctx } = await unlocked();
    const coin = soundFor({ kind: 'myMine' });
    synth.playSound('myMine', coin);
    const coinStart = ctx.oscillators[0]!.startedAt!;
    ctx.currentTime += 0.01;
    synth.playSound('win', soundFor({ kind: 'win' }));
    const fanfareStart = ctx.oscillators[coin.tones.length]!.startedAt!;
    expect(fanfareStart).toBeGreaterThanOrEqual(coinStart + soundLength(coin) - 0.001);
  });

  it('does not make a sound wait long: past the cap it plays now, on top', async () => {
    const { synth, ctx } = await unlocked();
    synth.playSound('win', soundFor({ kind: 'win' })); // 0.7 s, longer than the cap
    ctx.currentTime += 0.1;
    const before = ctx.oscillators.length;
    synth.playSound('myMine', soundFor({ kind: 'myMine' }));
    const start = ctx.oscillators[before]!.startedAt!;
    expect(start - ctx.currentTime).toBeLessThan(0.05);
  });
});

describe('a context that went back to sleep', () => {
  it('wakes it for next time instead of playing this one late', async () => {
    const { synth, ctx } = await unlocked();
    ctx.state = 'suspended';
    ctx.resume.mockClear();
    synth.playSound('myMine', soundFor({ kind: 'myMine' }));
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });
});
