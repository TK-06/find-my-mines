import { useCallback, useEffect, useState } from 'react';

/** The console's sections: the live server, and the game log. */
export type AdminTab = 'server' | 'games';

export const ADMIN_TABS: { key: AdminTab; label: string }[] = [
  { key: 'server', label: 'Server' },
  { key: 'games', label: 'Game log' },
];

/** The ids that tie a tab to its panel, for aria-controls and aria-labelledby. */
export const adminTabId = (tab: AdminTab) => `admin-tab-${tab}`;
export const adminPanelId = (tab: AdminTab) => `admin-panel-${tab}`;

/**
 * The tab a URL hash names. No hash, or one that names nothing, is the server
 * tab: /admin on its own has always opened the live console.
 */
export function adminTabFromHash(hash: string): AdminTab {
  return hash.replace(/^#/, '').toLowerCase() === 'games' ? 'games' : 'server';
}

/** The hash that opens a tab, for the address bar. */
export function hashForAdminTab(tab: AdminTab): string {
  return `#${tab}`;
}

/**
 * Which tab is open, kept in the URL hash (/admin#games) so a refresh, a
 * bookmark and the back button all keep it. Only the hash changes: the path and
 * the query stay as they are, and the query may hold the admin token the socket
 * reads at its handshake (/admin?token=…), so switching tabs never costs access.
 */
export function useAdminTab(): [AdminTab, (next: AdminTab) => void] {
  const [tab, setTab] = useState(() => adminTabFromHash(window.location.hash));

  useEffect(() => {
    // Back, forward and a hand-edited address change the tab as well.
    const onHashChange = () => setTab(adminTabFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** Setting the hash adds a history entry, so Back returns to the tab before. */
  const select = useCallback((next: AdminTab) => {
    window.location.hash = hashForAdminTab(next);
  }, []);

  return [tab, select];
}
