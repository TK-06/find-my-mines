/**
 * The three screen sizes every page lays out for, and the small pure rules the
 * responsive pieces share. styles.css uses the same numbers in its @media
 * queries (see the note at its top); keep the two in step.
 *
 *   phone    up to 639px   one column, panels fold into one-line summaries
 *   tablet   640–1023px    a main column and a narrow rail
 *   desktop  1024px up     the full layouts
 */
export const PHONE_MAX = 639;
export const DESKTOP_MIN = 1024;

/** Media queries for the hooks in useMediaQuery.ts. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN}px)`;

/**
 * Lines that arrived after `seenAt` from someone else: what the chat button's
 * badge counts. Your own lines never count as unread.
 */
export function unreadCount(
  messages: readonly { fromId: string; at: number }[],
  seenAt: number,
  myId: string | null,
): number {
  let count = 0;
  for (const message of messages) {
    if (message.at > seenAt && message.fromId !== myId) count += 1;
  }
  return count;
}

/** The badge's text: a number up to 99, then "99+". Nothing for none. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/**
 * The names on the phone's one-line "N online" summary: everyone but you, in
 * list order, up to `max`, and how many more there are after them.
 */
export function onlinePreview(
  online: readonly { id: string; nickname: string }[],
  myId: string | null,
  max: number,
): { names: string[]; more: number } {
  const others = online.filter((player) => player.id !== myId);
  const names = others.slice(0, Math.max(0, max)).map((player) => player.nickname);
  return { names, more: others.length - names.length };
}

/**
 * The first week the activity heatmap draws. A narrow card shows the last
 * `narrowWeeks` weeks so the squares stay big enough to see; asking for the
 * full year (or a card wide enough for it) starts at week 0.
 */
export function heatmapStart(totalWeeks: number, narrow: boolean, fullYear: boolean, narrowWeeks = 26): number {
  if (!narrow || fullYear) return 0;
  return Math.max(0, totalWeeks - narrowWeeks);
}

/**
 * The phone's Play page is a menu of three; each opens a screen of its own.
 * Which one is open rides in the browser history entry, so the phone's back
 * gesture returns to the menu.
 */
export type LobbyMode = 'games' | 'quick' | 'ai';
const LOBBY_MODES: readonly LobbyMode[] = ['games', 'quick', 'ai'];

/** The mode a history entry was pushed with, or null for the menu (or anything else). */
export function lobbyModeFrom(state: unknown): LobbyMode | null {
  const mode = (state as { lobbyMode?: unknown } | null)?.lobbyMode;
  return LOBBY_MODES.includes(mode as LobbyMode) ? (mode as LobbyMode) : null;
}
