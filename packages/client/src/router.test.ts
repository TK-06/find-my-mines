import { describe, expect, it } from 'vitest';
import { isPlainLeftClick, pathFor, routeFromPath, type Route } from './router.js';

describe('routeFromPath', () => {
  it('maps the policy pages', () => {
    expect(routeFromPath('/privacy')).toBe('privacy');
    expect(routeFromPath('/security')).toBe('security');
    expect(routeFromPath('/terms')).toBe('terms');
  });

  it('tolerates a trailing slash', () => {
    expect(routeFromPath('/terms/')).toBe('terms');
    expect(routeFromPath('/privacy//')).toBe('privacy');
  });

  it('sends anything unknown to the game', () => {
    expect(routeFromPath('/')).toBe('game');
    expect(routeFromPath('')).toBe('game');
    expect(routeFromPath('/nope')).toBe('game');
    expect(routeFromPath('/privacy/extra')).toBe('game');
  });

  it('round-trips every route through its path', () => {
    const routes: Route[] = ['game', 'profile', 'games', 'ranks', 'admin', 'privacy', 'security', 'terms'];
    for (const route of routes) expect(routeFromPath(pathFor(route))).toBe(route);
  });
});

describe('isPlainLeftClick', () => {
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };

  it('lets the app handle a plain left click', () => {
    expect(isPlainLeftClick(plain)).toBe(true);
  });

  it('leaves modified clicks to the browser — new tab, new window, download', () => {
    expect(isPlainLeftClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, altKey: true })).toBe(false);
  });

  it('leaves middle and right clicks to the browser', () => {
    expect(isPlainLeftClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainLeftClick({ ...plain, button: 2 })).toBe(false);
  });

  it('stays out of the way when another handler already took the click', () => {
    expect(isPlainLeftClick({ ...plain, defaultPrevented: true })).toBe(false);
  });
});
