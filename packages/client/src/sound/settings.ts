import { useSyncExternalStore } from 'react';

/**
 * The two switches in the header's speaker popover. Both start ON, and each
 * choice is kept in this browser's local storage — never sent anywhere.
 *
 * Every storage access is guarded, as in theme.ts: private windows and
 * browsers with site data blocked throw on access rather than returning null.
 * The choice then lasts for as long as the page does, and nothing breaks.
 */
export interface SoundSettings {
  sound: boolean;
  vibration: boolean;
}

export const SOUND_KEY = 'fmm.sound';
export const VIBRATION_KEY = 'fmm.vibration';

const KEYS: Readonly<Record<keyof SoundSettings, string>> = {
  sound: SOUND_KEY,
  vibration: VIBRATION_KEY,
};

export const DEFAULT_SETTINGS: SoundSettings = { sound: true, vibration: true };

/** What we write: "off" for off, "on" for on. Anything else stored — nothing, junk — means the default. */
export function parseFlag(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === 'off') return false;
  if (raw === 'on') return true;
  return fallback;
}

/** The part of `localStorage` the store uses, so a test can hand it a fake. */
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads both settings through `read`, tolerating storage that throws or holds anything. */
export function readSettings(read: (key: string) => string | null): SoundSettings {
  const flag = (name: keyof SoundSettings): boolean => {
    try {
      return parseFlag(read(KEYS[name]), DEFAULT_SETTINGS[name]);
    } catch {
      return DEFAULT_SETTINGS[name];
    }
  };
  return { sound: flag('sound'), vibration: flag('vibration') };
}

/**
 * A tiny store both the header's switches and the game's sound hook share, so
 * flipping a switch takes effect at once, everywhere, and in other tabs too.
 * `storage` is a function, so that even asking for `localStorage` happens
 * inside the guard.
 */
export function createSettingsStore(storage: () => FlagStorage) {
  const listeners = new Set<() => void>();
  let current: SoundSettings | null = null;

  const read = (): SoundSettings => readSettings((key) => storage().getItem(key));

  const get = (): SoundSettings => (current ??= read());

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const set = (name: keyof SoundSettings, value: boolean): void => {
    current = { ...get(), [name]: value };
    try {
      storage().setItem(KEYS[name], value ? 'on' : 'off');
    } catch {
      // A remembered choice is a convenience, never a requirement.
    }
    notify();
  };

  // Another tab changed a switch: pick up what it stored.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SOUND_KEY && event.key !== VIBRATION_KEY) return;
    const next = read();
    const now = get();
    if (next.sound === now.sound && next.vibration === now.vibration) return;
    current = next;
    notify();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
    };
  };

  return { get, set, subscribe };
}

const store = createSettingsStore(() => localStorage);

export function getSoundSettings(): SoundSettings {
  return store.get();
}

export function setSoundSetting(name: keyof SoundSettings, value: boolean): void {
  store.set(name, value);
}

/** The current settings, re-rendering the caller whenever either switch moves. */
export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
