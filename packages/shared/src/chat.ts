/** Longest chat line, in characters (code points, so an emoji counts as one). */
export const CHAT_MAX_LENGTH = 200;

/**
 * Control characters: C0 (newline, tab, escape, NUL…), DEL, and C1. A line
 * break or an escape sequence would let one message fake several lines or
 * mess with how the chat renders, so each becomes a plain space.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * A chat line made safe to send, or null when there is nothing worth sending.
 * Run by the server on everything it receives, and by the client's input so
 * people see the same limit before they press Enter.
 */
export function cleanChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  // Array.from splits by code point, so the cut can never land between the
  // two halves of an emoji's surrogate pair the way .slice() could.
  const chars = Array.from(text);
  const capped = chars.length > CHAT_MAX_LENGTH ? chars.slice(0, CHAT_MAX_LENGTH).join('').trimEnd() : text;
  return capped.length > 0 ? capped : null;
}
