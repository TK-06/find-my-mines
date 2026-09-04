import { useEffect, useState } from 'react';

export type Route = 'game' | 'profile' | 'games' | 'ranks' | 'admin';

const PATHS: Record<Route, string> = {
  game: '/',
  profile: '/profile',
  games: '/games',
  ranks: '/ranks',
  admin: '/admin',
};

/**
 * A four-route router in twenty lines.
 *
 * The server serves index.html for every path, so deep links work; this just
 * maps the pathname to a screen and pushes history on navigation. A real
 * router would be more dependency than this app needs.
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
    default:
      return 'game';
  }
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
