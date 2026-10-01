import { joinPathFor } from '../router.js';

/**
 * Share links for a room. Pure, so the Share popover only does the clicking:
 * what the link is, where LINE's share page lives, and what the phone's share
 * sheet says.
 */

/**
 * The link that brings someone straight into a room: /join/CODE on the origin
 * this page came from. The server (and Vercel's rewrite) serves the app on
 * every path, so the link opens the game, which joins the room.
 */
export function roomLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${joinPathFor(code)}`;
}

/** LINE's own share page, with the link filled in. Opens in a new tab. */
export function lineShareUrl(link: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(link)}`;
}

/** What the phone's share sheet (navigator.share) is handed. */
export function shareDetails(
  roomName: string,
  code: string,
  link: string,
): { title: string; text: string; url: string } {
  const name = roomName.trim();
  return {
    title: 'Find My Mines',
    text: name
      ? `Join my Find My Mines game “${name}” — room code ${code}.`
      : `Join my Find My Mines game — room code ${code}.`,
    url: link,
  };
}
