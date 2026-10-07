import { isMatchId, parseRoomCode } from '@fmm/shared';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

export type Route =
  | 'game'
  | 'profile'
  | 'ranks'
  | 'puzzle'
  | 'admin'
  | 'privacy'
  | 'security'
  | 'terms'
  /** Someone else's public profile: /u/<username>. */
  | 'player'
  /** Game review: /review/latest (the game just played) or /review/<match id>. */
  | 'review';

const PATHS: Record<Route, string> = {
  game: '/',
  profile: '/profile',
  ranks: '/ranks',
  puzzle: '/puzzle',
  admin: '/admin',
  privacy: '/privacy',
  security: '/security',
  terms: '/terms',
  // Never navigated to bare: see pathForPlayer.
  player: '/u',
  // Never navigated to bare either: see pathForReview.
  review: '/review',
};

/** The URL a route lives at — for real hrefs, so middle-click and "copy link" work. */
export function pathFor(route: Route): string {
  return PATHS[route];
}

/** Where a room's share link points: /join/CODE. */
export function joinPathFor(code: string): string {
  return `/join/${code.toUpperCase()}`;
}

/**
 * The room code in a share link's path, in capitals, or null anywhere else.
 * The path itself shows the game screen (see routeFromPath), which joins the
 * room once the player has a name.
 */
export function joinCodeFromPath(pathname: string): string | null {
  const match = /^\/join\/([^/]+)\/*$/.exec(pathname);
  return match ? parseRoomCode(match[1]) : null;
}

/** Where a player's public profile lives: /u/<username>. */
export function pathForPlayer(username: string): string {
  return `/u/${encodeURIComponent(username)}`;
}

/** The username in a /u/<username> path, or null anywhere else. */
export function playerNameFromPath(pathname: string): string | null {
  const match = /^\/u\/([^/]+)\/*$/.exec(pathname);
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]!).trim();
    return name.length >= 1 && name.length <= 20 ? name : null;
  } catch {
    // A broken %-escape names nobody.
    return null;
  }
}

/** What /review/<id> may name: the game just played, or a saved match. */
export type ReviewTarget = 'latest' | string;

/** Where a game's review lives: /review/latest, or /review/<match id>. */
export function pathForReview(target: ReviewTarget): string {
  return `/review/${target === 'latest' ? 'latest' : encodeURIComponent(target)}`;
}

/**
 * What a /review/<id> path asks for: `'latest'` for the game just played (kept
 * in this tab's memory), a match id for a saved game, or null anywhere else —
 * a path that names neither is not a review.
 */
export function reviewTargetFromPath(pathname: string): ReviewTarget | null {
  const match = /^\/review\/([^/]+)\/*$/.exec(pathname);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]!);
  } catch {
    // A broken %-escape names nothing.
    return null;
  }
  if (id === 'latest') return 'latest';
  return isMatchId(id) ? id.toLowerCase() : null;
}

/**
 * A small router in a few lines.
 *
 * The server serves index.html for every path, so deep links work; this just
 * maps the pathname to a screen and pushes history on navigation. A real
 * router would be more dependency than this app needs. Only the pathname is
 * read, so in-page #anchors never change the screen.
 *
 * /games is not a page of its own any more: the game log moved into the admin
 * console, so an old link or bookmark lands on the game like any unknown path.
 */
export function routeFromPath(pathname: string): Route {
  if (playerNameFromPath(pathname) !== null) return 'player';
  if (reviewTargetFromPath(pathname) !== null) return 'review';
  switch (pathname.replace(/\/+$/, '') || '/') {
    case '/admin':
      return 'admin';
    case '/profile':
      return 'profile';
    case '/ranks':
      return 'ranks';
    case '/puzzle':
      return 'puzzle';
    case '/privacy':
      return 'privacy';
    case '/security':
      return 'security';
    case '/terms':
      return 'terms';
    default:
      return 'game';
  }
}

type ClickLike = Pick<
  MouseEvent,
  'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'
>;

/**
 * Whether a click on an internal link is ours to handle. Anything else — a
 * modifier for a new tab or window, a middle click — belongs to the browser,
 * which follows the href and gets index.html like any deep link.
 */
export function isPlainLeftClick(event: ClickLike): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** A real link to another screen that navigates without a page reload. */
export function RouteLink({
  to,
  current,
  onNavigate,
  className,
  label,
  title,
  children,
}: {
  to: Route;
  /** The route on screen now, to mark this link as the current page. */
  current?: Route;
  onNavigate: (next: Route) => void;
  className?: string;
  /** The link's spoken name, for one that holds only a picture or an icon. */
  label?: string;
  /** A tooltip. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={PATHS[to]}
      className={className}
      aria-label={label}
      title={title}
      aria-current={current === to ? 'page' : undefined}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

/**
 * A player's name as a real link to their public profile (/u/<name>). A plain
 * click opens it without a page reload; a new tab, a middle click and "copy
 * link" are the browser's, and get the same address.
 */
export function PlayerLink({
  name,
  onOpen,
  tabIndex,
  children,
}: {
  name: string;
  onOpen: (name: string) => void;
  /** -1 where the surrounding widget handles the keyboard itself (the search dropdown). */
  tabIndex?: number;
  /** What the link says; the name itself when left out. */
  children?: ReactNode;
}) {
  return (
    <a
      href={pathForPlayer(name)}
      className="player-link"
      tabIndex={tabIndex}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        onOpen(name);
      }}
    >
      {children ?? name}
    </a>
  );
}

/**
 * The current screen, a way to change it, and the path itself — which a
 * screen with a parameter (/u/<name>) reads, and which changes even when the
 * route does not (one player's page to another's).
 */
export function useRoute(): [Route, (next: Route, path?: string) => void, string] {
  const [location, setLocation] = useState(() => ({
    route: routeFromPath(window.location.pathname),
    path: window.location.pathname,
  }));

  useEffect(() => {
    // Keep the back/forward buttons working.
    const onPop = () =>
      setLocation({ route: routeFromPath(window.location.pathname), path: window.location.pathname });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** `path` is for routes with a parameter in them, like a player's /u/<name>. */
  const navigate = (next: Route, path?: string) => {
    const to = path ?? PATHS[next];
    window.history.pushState({ depth: appDepth(window.history.state) + 1 }, '', to);
    setLocation({ route: next, path: to });
    // A new screen starts at its top, as a page load would. Footer links sit at
    // the very bottom, so without this the next page opens scrolled away.
    window.scrollTo(0, 0);
  };

  return [location.route, navigate, location.path];
}

/**
 * How many screens of this app sit behind the current history entry: 0 on a page
 * that was just loaded. Each `navigate` stamps the entry it pushes with one more
 * than the entry it left. The browser keeps the stamp through back, forward and a
 * reload, which a counter held in memory would not.
 */
export function appDepth(state: unknown): number {
  const depth = (state as { depth?: unknown } | null)?.depth;
  return typeof depth === 'number' && Number.isInteger(depth) && depth > 0 ? depth : 0;
}

/**
 * Whether one step back stays on this site, so a "Back" link may use the
 * browser's history instead of guessing where to go. That is so when an earlier
 * screen of this app is behind the entry (see appDepth), or when the page was
 * opened by a link from this site's own pages: the server console's game log opens
 * a review with a full page load, which leaves no stamp but does leave a referrer.
 * `history.length` cannot answer this — it also counts pages from other sites,
 * and a link from a search result would send the visitor straight back to it.
 */
export function canGoBack(state: unknown, referrer: string, origin: string): boolean {
  if (appDepth(state) > 0) return true;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    // No referrer (a typed address, a bookmark) or one that is not a URL.
    return false;
  }
}

/** canGoBack, asked of the page that is open. */
export function canGoBackHere(): boolean {
  return canGoBack(window.history.state, document.referrer, window.location.origin);
}

/**
 * The header's links to the main screens. Your own profile is not among them: it
 * is the round picture at the header's far right (see ProfileButton). The game
 * log is not a screen for players at all — it is a tab of the admin console.
 */
export function NavBar({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate: (next: Route) => void;
}) {
  const items: { key: Route; label: string }[] = [
    { key: 'game', label: 'Play' },
    { key: 'ranks', label: 'Rankings' },
    { key: 'puzzle', label: 'Puzzle' },
  ];

  return (
    <nav className="nav-bar">
      {items.map((item) => (
        <button
          key={item.key}
          className={route === item.key ? 'nav-link active' : 'nav-link'}
          onClick={() => onNavigate(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
