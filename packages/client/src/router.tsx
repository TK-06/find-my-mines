import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

export type Route =
  | 'game'
  | 'profile'
  | 'games'
  | 'ranks'
  | 'admin'
  | 'privacy'
  | 'security'
  | 'terms';

const PATHS: Record<Route, string> = {
  game: '/',
  profile: '/profile',
  games: '/games',
  ranks: '/ranks',
  admin: '/admin',
  privacy: '/privacy',
  security: '/security',
  terms: '/terms',
};

/** The URL a route lives at — for real hrefs, so middle-click and "copy link" work. */
export function pathFor(route: Route): string {
  return PATHS[route];
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
  switch (pathname.replace(/\/+$/, '') || '/') {
    case '/admin':
      return 'admin';
    case '/profile':
      return 'profile';
    case '/games':
      return 'games';
    case '/ranks':
      return 'ranks';
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

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    // Keep the back/forward buttons working.
    const onPop = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (next: Route) => {
    window.history.pushState({}, '', PATHS[next]);
    setRoute(next);
    // A new screen starts at its top, as a page load would. Footer links sit at
    // the very bottom, so without this the next page opens scrolled away.
    window.scrollTo(0, 0);
  };

  return [route, navigate];
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
