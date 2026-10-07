import { describe, expect, it } from 'vitest';
import { ADMIN_TABS, adminPanelId, adminTabFromHash, adminTabId, hashForAdminTab } from './adminTab.js';

describe('the console tab in the URL hash', () => {
  it('opens the game log for #games', () => {
    expect(adminTabFromHash('#games')).toBe('games');
    expect(adminTabFromHash('games')).toBe('games');
    expect(adminTabFromHash('#GAMES')).toBe('games');
  });

  it('opens the server for #server, no hash, or a hash that names nothing', () => {
    for (const hash of ['#server', '', '#', '#nope', '#games-extra', '#/games']) {
      expect(adminTabFromHash(hash), hash).toBe('server');
    }
  });

  it('reads back the hash it builds, for every tab', () => {
    for (const { key } of ADMIN_TABS) expect(adminTabFromHash(hashForAdminTab(key))).toBe(key);
  });

  it('gives every tab its own id and its panel its own id', () => {
    const ids = ADMIN_TABS.flatMap(({ key }) => [adminTabId(key), adminPanelId(key)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
