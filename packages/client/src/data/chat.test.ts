import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@fmm/shared';
import {
  CHAT_HISTORY_LIMIT,
  GROUP_WINDOW_MS,
  addChatMessage,
  canSendChat,
  formatClock,
  groupMessages,
  isNearBottom,
  isoTime,
} from './chat.js';

const ROOM = 'ROOM';
const T0 = new Date(2026, 8, 29, 9, 5, 0).getTime();

let seq = 0;
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${seq++}`,
  roomId: ROOM,
  fromId: 'ann',
  fromName: 'Ann',
  kind: 'player',
  text: 'hi',
  at: T0,
  ...over,
});

describe('addChatMessage', () => {
  it('appends a message for the room this client follows', () => {
    const first = msg();
    const second = msg({ text: 'again' });
    expect(addChatMessage(addChatMessage([], first, ROOM), second, ROOM)).toEqual([first, second]);
  });

  it("ignores another room's message — a late one must not leak into the next room", () => {
    const list = [msg()];
    expect(addChatMessage(list, msg({ roomId: 'OTHER' }), ROOM)).toBe(list);
  });

  it('ignores everything while this client follows no room', () => {
    const list: ChatMessage[] = [];
    expect(addChatMessage(list, msg(), null)).toBe(list);
  });

  it('ignores a message it already has', () => {
    const once = msg();
    const list = [once];
    expect(addChatMessage(list, { ...once }, ROOM)).toBe(list);
  });

  it('ignores something that is not a chat line at all', () => {
    const list: ChatMessage[] = [];
    expect(addChatMessage(list, { ...msg(), text: undefined } as unknown as ChatMessage, ROOM)).toBe(
      list,
    );
    expect(addChatMessage(list, null as unknown as ChatMessage, ROOM)).toBe(list);
  });

  it(`keeps only the newest ${CHAT_HISTORY_LIMIT}`, () => {
    let list: ChatMessage[] = [];
    for (let n = 0; n < CHAT_HISTORY_LIMIT + 5; n++) {
      list = addChatMessage(list, msg({ id: `n${n}` }), ROOM);
    }
    expect(CHAT_HISTORY_LIMIT).toBe(100);
    expect(list).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(list[0]!.id).toBe('n5');
    expect(list.at(-1)!.id).toBe(`n${CHAT_HISTORY_LIMIT + 4}`);
  });

  it('takes a smaller limit when asked', () => {
    let list: ChatMessage[] = [];
    for (const id of ['a', 'b', 'c']) list = addChatMessage(list, msg({ id }), ROOM, 2);
    expect(list.map((m) => m.id)).toEqual(['b', 'c']);
  });
});

describe('groupMessages', () => {
  it('is empty for no messages', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('puts consecutive lines from one sender under one header', () => {
    const a = msg({ at: T0 });
    const b = msg({ at: T0 + 30_000 });
    const groups = groupMessages([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: a.id, fromId: 'ann', fromName: 'Ann', kind: 'player', at: T0 });
    expect(groups[0]!.messages).toEqual([a, b]);
  });

  it('starts a new header when someone else speaks in between', () => {
    const groups = groupMessages([
      msg({ fromId: 'ann' }),
      msg({ fromId: 'bo', fromName: 'Bo' }),
      msg({ fromId: 'ann' }),
    ]);
    expect(groups.map((g) => g.fromId)).toEqual(['ann', 'bo', 'ann']);
  });

  it(`starts a new header once ${GROUP_WINDOW_MS / 60_000} minutes have passed since the header`, () => {
    expect(GROUP_WINDOW_MS).toBe(2 * 60_000);
    const groups = groupMessages([
      msg({ at: T0 }),
      msg({ at: T0 + 60_000 }),
      // Within a minute of the line before, but past the window from the
      // header — every line under a header was sent close to the time it shows.
      msg({ at: T0 + GROUP_WINDOW_MS + 1 }),
    ]);
    expect(groups.map((g) => g.messages.length)).toEqual([2, 1]);
    expect(groups[1]!.at).toBe(T0 + GROUP_WINDOW_MS + 1);
  });

  it('keeps a line exactly at the window edge in the group', () => {
    const groups = groupMessages([msg({ at: T0 }), msg({ at: T0 + GROUP_WINDOW_MS })]);
    expect(groups).toHaveLength(1);
  });

  it('never groups the computer with a player, even under the same id', () => {
    const groups = groupMessages([msg({ fromId: 'x' }), msg({ fromId: 'x', kind: 'bot' })]);
    expect(groups.map((g) => g.kind)).toEqual(['player', 'bot']);
  });

  it('starts a new header for a line stamped earlier than its header', () => {
    const groups = groupMessages([msg({ at: T0 }), msg({ at: T0 - 1000 })]);
    expect(groups).toHaveLength(2);
  });
});

describe('formatClock', () => {
  it('is the local time as HH:MM, 24-hour, zero-padded', () => {
    expect(formatClock(new Date(2026, 8, 29, 9, 5).getTime())).toBe('09:05');
    expect(formatClock(new Date(2026, 8, 29, 0, 0).getTime())).toBe('00:00');
    expect(formatClock(new Date(2026, 8, 29, 23, 59, 59).getTime())).toBe('23:59');
  });

  it('shows nothing for a time it cannot read', () => {
    expect(formatClock(Number.NaN)).toBe('');
  });
});

describe('isoTime', () => {
  it('is the machine-readable form for a <time> element', () => {
    expect(isoTime(Date.UTC(2026, 8, 29, 9, 5))).toBe('2026-09-29T09:05:00.000Z');
  });

  it('is undefined — never a thrown error — for a time it cannot read', () => {
    expect(isoTime(Number.NaN)).toBeUndefined();
    expect(isoTime(9e15)).toBeUndefined();
  });
});

describe('canSendChat', () => {
  it('refuses an empty or blank line', () => {
    expect(canSendChat('')).toBe(false);
    expect(canSendChat('   \t ')).toBe(false);
  });

  it('allows an ordinary line', () => {
    expect(canSendChat('good luck')).toBe(true);
    expect(canSendChat('  gg  ')).toBe(true);
  });
});

describe('isNearBottom', () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 300 });

  it('is true at the bottom and within a small slack of it', () => {
    expect(isNearBottom(box(700))).toBe(true);
    expect(isNearBottom(box(680))).toBe(true);
  });

  it('is false once the reader has scrolled up', () => {
    expect(isNearBottom(box(600))).toBe(false);
    expect(isNearBottom(box(0))).toBe(false);
  });

  it('is true when everything fits without scrolling', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 })).toBe(true);
  });
});
