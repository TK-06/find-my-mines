import { describe, expect, it } from 'vitest';
import {
  appDepth,
  canGoBack,
  isPlainLeftClick,
  joinCodeFromPath,
  joinPathFor,
  pathFor,
  pathForPlayer,
  pathForReview,
  playerNameFromPath,
  reviewTargetFromPath,
  routeFromPath,
  type Route,
} from './router.js';

describe('share links: /join/CODE', () => {
  it('shows the game for a join link — the lobby is where joining happens', () => {
    expect(routeFromPath('/join/ABCD')).toBe('game');
    expect(routeFromPath('/join/abcd/')).toBe('game');
  });

  it('reads the room code from a join link, in capitals', () => {
    expect(joinCodeFromPath('/join/ABCD')).toBe('ABCD');
    expect(joinCodeFromPath('/join/q7k2')).toBe('Q7K2');
    expect(joinCodeFromPath('/join/WXYZ/')).toBe('WXYZ');
  });

  it('finds no code anywhere else', () => {
    for (const path of ['/', '', '/profile', '/join', '/join/', '/join/ABC', '/join/ABCDE', '/join/AB-D', '/join/ABCD/extra', '/games/join/ABCD']) {
      expect(joinCodeFromPath(path)).toBeNull();
    }
  });

  it('builds the path a share link points at, and reads it back', () => {
    expect(joinPathFor('abcd')).toBe('/join/ABCD');
    expect(joinCodeFromPath(joinPathFor('Q7K2'))).toBe('Q7K2');
  });
});

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
    const routes: Route[] = ['game', 'profile', 'ranks', 'puzzle', 'admin', 'privacy', 'security', 'terms'];
    for (const route of routes) expect(routeFromPath(pathFor(route))).toBe(route);
  });

  it('shows the game for /games: the game log is an admin tab now, not a page for players', () => {
    expect(routeFromPath('/games')).toBe('game');
    expect(routeFromPath('/games/')).toBe('game');
  });
});

describe('going back', () => {
  const ORIGIN = 'https://findmymines.example';

  it('counts the screens of this app behind the current entry, from the entry itself', () => {
    expect(appDepth({ depth: 2 })).toBe(2);
    expect(appDepth({ depth: 1 })).toBe(1);
  });

  it('counts none on a fresh load, or for a state this app did not write', () => {
    for (const state of [null, undefined, {}, { depth: 0 }, { depth: -1 }, { depth: 1.5 }, { depth: '2' }, 'x', 7]) {
      expect(appDepth(state)).toBe(0);
    }
  });

  it('goes back once the app itself has been navigated, whatever the referrer says', () => {
    expect(canGoBack({ depth: 1 }, '', ORIGIN)).toBe(true);
    expect(canGoBack({ depth: 3 }, 'https://www.google.com/', ORIGIN)).toBe(true);
  });

  it('goes back to a page of this site that opened this one with a full page load', () => {
    expect(canGoBack(null, `${ORIGIN}/admin?token=abc`, ORIGIN)).toBe(true);
    expect(canGoBack(null, `${ORIGIN}/`, ORIGIN)).toBe(true);
  });

  it('does not send a visitor back to another site, or to nothing', () => {
    expect(canGoBack(null, 'https://www.google.com/search?q=mines', ORIGIN)).toBe(false);
    // A lookalike address is another origin.
    expect(canGoBack(null, 'https://findmymines.example.evil.test/', ORIGIN)).toBe(false);
    expect(canGoBack(null, '', ORIGIN)).toBe(false);
    expect(canGoBack(null, 'not a url', ORIGIN)).toBe(false);
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

describe('player profiles: /u/<username>', () => {
  it('opens the player page for a username path', () => {
    expect(routeFromPath('/u/tamago')).toBe('player');
    expect(routeFromPath('/u/tamago/')).toBe('player');
    expect(playerNameFromPath('/u/tamago')).toBe('tamago');
  });

  it('round-trips names with spaces, underscores and other scripts', () => {
    for (const name of ['mine_hunter', 'Bob Smith', 'ปาล์ม', 'a/b?c#d']) {
      expect(playerNameFromPath(pathForPlayer(name))).toBe(name);
    }
  });

  it('names nobody for a bare /u, an extra segment, a broken escape or an overlong name', () => {
    for (const path of ['/u', '/u/', '/u/a/b', '/u/%E0%A4%A', `/u/${'x'.repeat(21)}`, '/profile']) {
      expect(playerNameFromPath(path)).toBeNull();
    }
    expect(routeFromPath('/u')).toBe('game');
  });
});

describe('game review: /review/latest and /review/<match id>', () => {
  const ID = '6a2b1f2e-0000-4000-8000-000000000001';

  it('opens the review screen for the game just played, and for a saved match', () => {
    expect(routeFromPath('/review/latest')).toBe('review');
    expect(routeFromPath('/review/latest/')).toBe('review');
    expect(routeFromPath(`/review/${ID}`)).toBe('review');
    expect(routeFromPath(`/review/${ID}/`)).toBe('review');
  });

  it('reads what the path asks for', () => {
    expect(reviewTargetFromPath('/review/latest')).toBe('latest');
    expect(reviewTargetFromPath(`/review/${ID}`)).toBe(ID);
    // A match id is the same id in capitals; it is read in lower case.
    expect(reviewTargetFromPath(`/review/${ID.toUpperCase()}`)).toBe(ID);
  });

  it('builds the path and reads it back', () => {
    expect(pathForReview('latest')).toBe('/review/latest');
    expect(pathForReview(ID)).toBe(`/review/${ID}`);
    expect(reviewTargetFromPath(pathForReview('latest'))).toBe('latest');
    expect(reviewTargetFromPath(pathForReview(ID))).toBe(ID);
  });

  it('names nothing for a bare /review, another word, an extra segment, a made-up id or a broken escape', () => {
    for (const path of ['/review', '/review/', '/review/other', '/review/123', `/review/${ID}/extra`, `/review/${ID}0`, '/review/%E0%A4%A', '/reviews/latest', '/games/review/latest']) {
      expect(reviewTargetFromPath(path), path).toBeNull();
    }
  });

  it('sends a path that is not a review to the game, as every unknown path goes', () => {
    expect(routeFromPath('/review')).toBe('game');
    expect(routeFromPath('/review/other')).toBe('game');
  });

  it('does not take a profile or a join link for a review', () => {
    expect(routeFromPath('/u/latest')).toBe('player');
    expect(routeFromPath('/join/ABCD')).toBe('game');
  });
});
