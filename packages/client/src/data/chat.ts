import { cleanChatText, type ChatMessage } from '@fmm/shared';

/**
 * Pure rules for the room chat: which lines to keep, how they group under a
 * header, and how their time reads. No socket, no DOM — useGame and RoomChat
 * do the I/O, this decides what it means.
 */

/** Lines kept on screen. The server stores none, so older ones are simply gone. */
export const CHAT_HISTORY_LIMIT = 100;

/**
 * Lines from one sender share a header for this long after the header's own
 * time — so every line under a header was sent close to the time it shows.
 */
export const GROUP_WINDOW_MS = 2 * 60_000;

/**
 * Adds a line from the server, if it belongs here: only the room this client
 * follows (a late line from the room just left must not leak into the next),
 * each line once, and only the newest `limit`. Returns the same list when
 * nothing changed, so React skips the re-render.
 */
export function addChatMessage(
  list: ChatMessage[],
  message: ChatMessage,
  roomId: string | null,
  limit = CHAT_HISTORY_LIMIT,
): ChatMessage[] {
  if (roomId === null || message?.roomId !== roomId) return list;
  if (typeof message.id !== 'string' || typeof message.text !== 'string') return list;
  if (list.some((m) => m.id === message.id)) return list;
  return [...list, message].slice(-limit);
}

/** A run of lines from one sender, shown under one name and time. */
export interface ChatGroup {
  /** The first line's id — stable while lines are added below it. */
  key: string;
  fromId: string;
  fromName: string;
  kind: ChatMessage['kind'];
  /** When the first line was sent. */
  at: number;
  messages: ChatMessage[];
}

/**
 * Groups consecutive lines like Discord: same sender (a person and the
 * computer never share a header, whatever their ids), within the window of
 * the header's time.
 */
export function groupMessages(list: ChatMessage[], windowMs = GROUP_WINDOW_MS): ChatGroup[] {
  const groups: ChatGroup[] = [];
  for (const message of list) {
    const last = groups.at(-1);
    const since = last ? message.at - last.at : -1;
    if (
      last &&
      last.fromId === message.fromId &&
      last.kind === message.kind &&
      since >= 0 &&
      since <= windowMs
    ) {
      last.messages.push(message);
    } else {
      groups.push({
        key: message.id,
        fromId: message.fromId,
        fromName: message.fromName,
        kind: message.kind,
        at: message.at,
        messages: [message],
      });
    }
  }
  return groups;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "09:05": local time, 24-hour. Empty for a time that cannot be read. */
export function formatClock(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The same instant for a `<time dateTime>`. Undefined for a time that cannot
 * be read — `toISOString` throws on those, and one bad line must not take the
 * room view down with it.
 */
export function isoTime(at: number): string | undefined {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Whether the Send button should work — the same cleaning the server applies. */
export function canSendChat(draft: string): boolean {
  return cleanChatText(draft) !== null;
}

/**
 * Whether a scrolled list is at (or within a few pixels of) its newest line.
 * The chat follows new lines only then, so a reader scrolled up to an older
 * line is not yanked away from it.
 */
export function isNearBottom(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  slack = 24,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}
