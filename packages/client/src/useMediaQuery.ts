import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { DESKTOP_QUERY, PHONE_QUERY } from './data/layout.js';

/**
 * Whether a media query matches right now, kept up to date as the window
 * changes size or the phone turns. False where matchMedia is missing (some
 * embedded browsers), which picks the desktop-ish layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      // Some embedded browsers skip the change event; a resize re-reads it too.
      window.addEventListener('resize', onChange);
      return () => {
        list.removeEventListener('change', onChange);
        window.removeEventListener('resize', onChange);
      };
    },
    [query],
  );
  const read = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Phone width: under 640px. */
export const useIsPhone = () => useMediaQuery(PHONE_QUERY);
/** Desktop width: 1024px and up. */
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

/**
 * The width of an element's content box, followed as it changes. 0 until the
 * element is on the page, and where ResizeObserver is missing.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  // Measured before the first paint, so a layout that depends on it (the
  // upright puzzle board) never flashes the wrong way first; then followed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setWidth(Math.round(el.clientWidth - (Number.isFinite(padding) ? padding : 0)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
