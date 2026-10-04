import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SOUND_KEY,
  VIBRATION_KEY,
  createSettingsStore,
  parseFlag,
  readSettings,
  type FlagStorage,
} from './settings.js';

/** A storage that keeps its values in a plain object. */
function fakeStorage(initial: Record<string, string> = {}): FlagStorage & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

/** Storage as a private window or a browser with site data blocked has it: every touch throws. */
const blockedStorage: FlagStorage = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
};

describe('the keys', () => {
  it('are the two the privacy page lists', () => {
    expect(SOUND_KEY).toBe('fmm.sound');
    expect(VIBRATION_KEY).toBe('fmm.vibration');
  });
});

describe('parseFlag', () => {
  it('reads what the store writes', () => {
    expect(parseFlag('on', false)).toBe(true);
    expect(parseFlag('off', true)).toBe(false);
  });

  it('takes the default for nothing, or for anything else', () => {
    expect(parseFlag(null, true)).toBe(true);
    expect(parseFlag(undefined, false)).toBe(false);
    expect(parseFlag('', true)).toBe(true);
    expect(parseFlag('false', true)).toBe(true);
    expect(parseFlag('{"x":1}', false)).toBe(false);
  });
});

describe('readSettings', () => {
  it('both start on when nothing is stored', () => {
    expect(readSettings(() => null)).toEqual({ sound: true, vibration: true });
    expect(DEFAULT_SETTINGS).toEqual({ sound: true, vibration: true });
  });

  it('reads each switch on its own key', () => {
    const storage = fakeStorage({ [SOUND_KEY]: 'off' });
    expect(readSettings((key) => storage.getItem(key))).toEqual({ sound: false, vibration: true });
    const other = fakeStorage({ [VIBRATION_KEY]: 'off' });
    expect(readSettings((key) => other.getItem(key))).toEqual({ sound: true, vibration: false });
  });

  it('survives storage that throws, falling back to on', () => {
    expect(readSettings((key) => blockedStorage.getItem(key))).toEqual({ sound: true, vibration: true });
  });

  it('survives rubbish left in storage', () => {
    const storage = fakeStorage({ [SOUND_KEY]: '\u0000garbage', [VIBRATION_KEY]: '42' });
    expect(readSettings((key) => storage.getItem(key))).toEqual({ sound: true, vibration: true });
  });
});

describe('the settings store', () => {
  it('starts with both on', () => {
    expect(createSettingsStore(() => fakeStorage()).get()).toEqual({ sound: true, vibration: true });
  });

  it('starts from what is stored', () => {
    const store = createSettingsStore(() => fakeStorage({ [SOUND_KEY]: 'off', [VIBRATION_KEY]: 'on' }));
    expect(store.get()).toEqual({ sound: false, vibration: true });
  });

  it('writes a change to its own key, as on or off', () => {
    const storage = fakeStorage();
    const store = createSettingsStore(() => storage);
    store.set('sound', false);
    expect(storage.values).toEqual({ [SOUND_KEY]: 'off' });
    store.set('vibration', false);
    store.set('sound', true);
    expect(storage.values).toEqual({ [SOUND_KEY]: 'on', [VIBRATION_KEY]: 'off' });
    expect(store.get()).toEqual({ sound: true, vibration: false });
  });

  it('remembers across a reload: a new store reads what the old one wrote', () => {
    const storage = fakeStorage();
    createSettingsStore(() => storage).set('vibration', false);
    expect(createSettingsStore(() => storage).get()).toEqual({ sound: true, vibration: false });
  });

  it('hands out the very same object until something changes, which React needs', () => {
    const store = createSettingsStore(() => fakeStorage());
    expect(store.get()).toBe(store.get());
    const before = store.get();
    store.set('sound', false);
    expect(store.get()).not.toBe(before);
    expect(store.get()).toBe(store.get());
  });

  it('tells its listeners when a switch moves, and not after they leave', () => {
    const store = createSettingsStore(() => fakeStorage());
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.set('sound', false);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set('sound', true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps working for this visit when storage is blocked', () => {
    const store = createSettingsStore(() => blockedStorage);
    expect(store.get()).toEqual({ sound: true, vibration: true });
    expect(() => store.set('sound', false)).not.toThrow();
    expect(store.get()).toEqual({ sound: false, vibration: true });
  });

  it('copes when asking for storage itself throws (no localStorage at all)', () => {
    const store = createSettingsStore(() => {
      throw new ReferenceError('localStorage is not defined');
    });
    expect(store.get()).toEqual({ sound: true, vibration: true });
    expect(() => store.set('vibration', false)).not.toThrow();
    expect(store.get().vibration).toBe(false);
  });
});
