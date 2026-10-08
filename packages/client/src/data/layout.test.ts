import { describe, expect, it } from 'vitest';
import { badgeText, DESKTOP_QUERY, heatmapStart, lobbyModeFrom, onlinePreview, PHONE_QUERY, unreadCount } from './layout.js';

describe('breakpoints', () => {
  it('phone and desktop queries do not overlap and leave the tablet range between them', () => {
    expect(PHONE_QUERY).toBe('(max-width: 639px)');
    expect(DESKTOP_QUERY).toBe('(min-width: 1024px)');
  });
});

describe('unreadCount', () => {
  const lines = [
    { fromId: 'a', at: 100 },
    { fromId: 'me', at: 200 },
    { fromId: 'b', at: 300 },
    { fromId: 'a', at: 400 },
  ];

  it('counts lines after the last look, from other people only', () => {
    expect(unreadCount(lines, 150, 'me')).toBe(2);
  });

  it('counts nothing once everything has been seen', () => {
    expect(unreadCount(lines, 400, 'me')).toBe(0);
  });

  it('counts a line at exactly the seen time as seen', () => {
    expect(unreadCount(lines, 300, 'me')).toBe(1);
  });

  it('counts every line from others before a name is picked', () => {
    expect(unreadCount(lines, 0, null)).toBe(4);
  });
});

describe('badgeText', () => {
  it('shows nothing for no unread lines', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-3)).toBeNull();
  });

  it('caps at 99+', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('onlinePreview', () => {
  const online = [
    { id: 'me', nickname: 'Tester' },
    { id: '1', nickname: 'Mali' },
    { id: '2', nickname: 'Krit' },
    { id: '3', nickname: 'Ploy' },
  ];

  it('leaves you out and says how many more there are', () => {
    expect(onlinePreview(online, 'me', 2)).toEqual({ names: ['Mali', 'Krit'], more: 1 });
  });

  it('lists everyone when they fit', () => {
    expect(onlinePreview(online, 'me', 5)).toEqual({ names: ['Mali', 'Krit', 'Ploy'], more: 0 });
  });

  it('is empty when you are alone', () => {
    expect(onlinePreview([online[0]!], 'me', 3)).toEqual({ names: [], more: 0 });
  });

  it('treats a negative limit as none', () => {
    expect(onlinePreview(online, 'me', -1)).toEqual({ names: [], more: 3 });
  });
});

describe('heatmapStart', () => {
  it('starts at the first week on a wide card', () => {
    expect(heatmapStart(53, false, false)).toBe(0);
  });

  it('shows the last 26 weeks on a narrow card', () => {
    expect(heatmapStart(53, true, false)).toBe(27);
  });

  it('shows the whole year when asked, even on a narrow card', () => {
    expect(heatmapStart(53, true, true)).toBe(0);
  });

  it('never starts before the first week', () => {
    expect(heatmapStart(10, true, false)).toBe(0);
  });
});

describe('lobbyModeFrom', () => {
  it('reads the mode a history entry was pushed with', () => {
    expect(lobbyModeFrom({ depth: 2, lobbyMode: 'games' })).toBe('games');
    expect(lobbyModeFrom({ lobbyMode: 'quick' })).toBe('quick');
    expect(lobbyModeFrom({ lobbyMode: 'ai' })).toBe('ai');
  });

  it('is the menu for any other entry', () => {
    expect(lobbyModeFrom(null)).toBeNull();
    expect(lobbyModeFrom(undefined)).toBeNull();
    expect(lobbyModeFrom({ depth: 1 })).toBeNull();
    expect(lobbyModeFrom({ lobbyMode: 'puzzle' })).toBeNull();
    expect(lobbyModeFrom('games')).toBeNull();
  });
});
