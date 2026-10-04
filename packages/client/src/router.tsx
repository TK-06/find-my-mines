import { parseRoomCode } from '@fmm/shared';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

export type Route =
  | 'game'
  | 'profile'
  | 'games'
  | 'ranks'
  | 'puzzle'
  | 'admin'
  | 'privacy'
  | 'security'
  | 'terms'
  /** Someone else's public profile: /u/<username>. */
  | 'player';

const PATHS: Record<Route, string> = {
  game: '/',
  profile: '/profile',
  games: '/games',
  ranks: '/ranks',
  puzzle: '/puzzle',
  admin: '/admin',
  privacy: '/privacy',
  security: '/security',
  terms: '/terms',
  // Never navigated to bare: see pathForPlayer.
  player: '/u',
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

/**
 * A small router in a few lines.
 *
 * The server serves index.html for every path, so deep links work; this just
 * maps the pathname to a screen and pushes history on navigation. A real
 * router would be more dependency than this app needs. Only the pathname is
 * read, so in-page #anchors never change the screen.
 */
export function routeFromPath(pathname: string): Route {
  if (playerNameFromPath(pathname) !== null) return 'player';
  switch (pathname.replace(/\/+$/, '') || '/') {
    case '/admin':
      return 'admin';
    case '/profile':
      return 'profile';
    case '/games':
      return 'games';
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
  children,
}: {
  to: Route;
  /** The route on screen now, to mark this link as the current page. */
  current?: Route;
  onNavigate: (next: Route) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={PATHS[to]}
      className={className}
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
    window.history.pushState({}, '', to);
    setLocation({ route: next, path: to });
    // A new screen starts at its top, as a page load would. Footer links sit at
    // the very bottom, so without this the next page opens scrolled away.
    window.scrollTo(0, 0);
  };

  return [location.route, navigate, location.path];
}

export function NavBar({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate: (next: Route) => void;
}) {
  const items: { key: Route; label: string }[] = [
    { key: 'game', label: 'Play' },
    { key: 'profile', label: 'Profile' },
    { key: 'games', label: 'Game log' },
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
