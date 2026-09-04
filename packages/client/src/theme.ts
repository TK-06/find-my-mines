import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'fmm.theme';

/**
 * Reads the stored preference, falling back to the operating system setting.
 *
 * Every storage access is guarded: private windows and browsers with site data
 * blocked throw on access rather than returning null.
 */
export function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage unavailable — fall through to the system preference.
  }

  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // matchMedia missing in some embedded contexts.
  }

  return 'dark';
}

/** Theme is applied as a data attribute so CSS can switch on it alone. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // A remembered theme is a convenience, never a requirement.
    }
  }, [theme]);

  return [theme, () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))];
}
