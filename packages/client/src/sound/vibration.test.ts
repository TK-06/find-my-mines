import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIBRATE_MS, canVibrate, vibrate } from './vibration.js';

/** Stands in for the browser: whether it can vibrate, asks for less motion, has been touched. */
function browser({
  vibrates = true,
  reducedMotion = false,
  touched,
}: {
  vibrates?: boolean | 'throws';
  reducedMotion?: boolean;
  touched?: boolean;
} = {}) {
  const buzz = vi.fn(() => true);
  const navigatorStub: Record<string, unknown> = {};
  if (vibrates === 'throws') {
    navigatorStub.vibrate = () => {
      throw new Error('refused');
    };
  } else if (vibrates) {
    navigatorStub.vibrate = buzz;
  }
  if (touched !== undefined) navigatorStub.userActivation = { hasBeenActive: touched };
  vi.stubGlobal('navigator', navigatorStub);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) });
  return buzz;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canVibrate', () => {
  it('is true where the browser has navigator.vibrate', () => {
    browser();
    expect(canVibrate()).toBe(true);
  });

  it('is false where it has not — iPhones and iPads', () => {
    browser({ vibrates: false });
    expect(canVibrate()).toBe(false);
  });
});

describe('vibrate', () => {
  it('is one short buzz of about 80 ms', () => {
    const buzz = browser();
    vibrate();
    expect(buzz).toHaveBeenCalledTimes(1);
    expect(buzz).toHaveBeenCalledWith(VIBRATE_MS);
    expect(VIBRATE_MS).toBe(80);
  });

  it('does nothing when the system asks for reduced motion', () => {
    const buzz = browser({ reducedMotion: true });
    vibrate();
    expect(buzz).not.toHaveBeenCalled();
  });

  it('does nothing, and does not fail, where there is no navigator.vibrate', () => {
    browser({ vibrates: false });
    expect(() => vibrate()).not.toThrow();
  });

  it('waits until the person has touched the page, as Chrome insists', () => {
    const before = browser({ touched: false });
    vibrate();
    expect(before).not.toHaveBeenCalled();

    const after = browser({ touched: true });
    vibrate();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('shrugs off a browser that refuses', () => {
    browser({ vibrates: 'throws' });
    expect(() => vibrate()).not.toThrow();
  });

  it('still buzzes when matchMedia is missing', () => {
    const buzz = browser();
    vi.stubGlobal('window', {});
    vibrate();
    expect(buzz).toHaveBeenCalledTimes(1);
  });
});
